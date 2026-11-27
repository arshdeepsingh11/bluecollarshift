import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createConversationSchema, isStaffRole, markReadSchema, sendMessageSchema, type Conversation, type Message } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requireCompany } from '../lib/actor';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { companyIdParams, companyParams } from '../lib/http';
import { notify } from '../services/notify';

export default async function messagingRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;

  app.get('/companies/:companyId/conversations', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select c.id, c.kind, c.title, c.last_message_at,
                (select json_agg(json_build_object('membershipId', mm.id, 'fullName', p.full_name) order by p.full_name)
                   from app.conversation_members cm2 join app.memberships mm on mm.id = cm2.membership_id join app.profiles p on p.user_id = mm.user_id
                  where cm2.conversation_id = c.id) as members,
                (select json_build_object('body', left(msg.body, 140), 'createdAt', msg.created_at, 'senderName', sp.full_name)
                   from app.messages msg join app.memberships sm on sm.id = msg.sender_membership_id join app.profiles sp on sp.user_id = sm.user_id
                  where msg.conversation_id = c.id order by msg.created_at desc limit 1) as last_message,
                (select count(*) from app.messages msg where msg.conversation_id = c.id and msg.sender_membership_id <> $2
                   and msg.created_at > coalesce(cm.last_read_at, 'epoch'))::int as unread
           from app.conversations c join app.conversation_members cm on cm.conversation_id = c.id and cm.membership_id = $2
          where c.company_id = $1 order by c.last_message_at desc nulls last limit 200`,
        [companyId, m.membershipId],
      )).rows,
    );
    const items: Conversation[] = rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, members: r.members ?? [], lastMessage: r.last_message, unread: r.unread, lastMessageAt: r.last_message_at }));
    return { items };
  });

  /** People the caller may message: staff for employees; everyone in scope for staff. */
  app.get('/companies/:companyId/contacts', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'messages.send');
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select m.id, p.full_name, m.role, m.job_title from app.memberships m join app.profiles p on p.user_id = m.user_id
          where m.company_id = $1 and m.status = 'active' and m.id <> $2 and ($3 or m.role <> 'employee') order by p.full_name`,
        [companyId, m.membershipId, isStaffRole(m.role)],
      )).rows,
    );
    return { items: rows.map((r) => ({ membershipId: r.id, fullName: r.full_name, role: r.role, jobTitle: r.job_title })) };
  });

  app.post('/companies/:companyId/conversations', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'messages.send');
    const b = parse(createConversationSchema, req.body);
    const others = [...new Set(b.memberIds.filter((id) => id !== m.membershipId))];
    if (!others.length) throw badRequest('Choose at least one other person.');
    if (b.kind === 'direct' && others.length !== 1) throw badRequest('A direct conversation has exactly one other person.');
    if (b.kind === 'announcement' && !m.permissions.has('announcements.send')) throw forbidden();
    if (b.kind === 'group' && !isStaffRole(m.role)) throw forbidden('Only managers can create group conversations.');

    const conv = await db.asUser(a.userId, async (tx) => {
      // Recipients must be active members of the same company. Employees may only message staff ("authorized contacts").
      const targets = (await tx.query(`select id, role, user_id from app.memberships where company_id = $1 and status = 'active' and id = any($2)`, [companyId, others])).rows;
      if (targets.length !== others.length) {
        // Employees cannot see other employees (RLS), so an unseen recipient means "not allowed".
        if (!isStaffRole(m.role)) throw forbidden('Employees can message managers and supervisors only.');
        throw badRequest('One or more recipients are not in your company.');
      }
      if (!isStaffRole(m.role) && targets.some((t) => t.role === 'employee')) throw forbidden('Employees can message managers and supervisors only.');
      const directKey = b.kind === 'direct' ? [m.membershipId, others[0]!].sort().join(':') : null;
      if (directKey) {
        const existing = (await tx.query(`select id from app.conversations where company_id = $1 and direct_key = $2`, [companyId, directKey])).rows[0];
        if (existing) return { id: existing.id as string, existed: true };
      }
      const c = (await tx.query(
        `insert into app.conversations (company_id, kind, title, direct_key, created_by_membership_id) values ($1,$2,$3,$4,$5) returning id`,
        [companyId, b.kind, b.title ?? null, directKey, m.membershipId],
      )).rows[0];
      await tx.query(`insert into app.conversation_members (conversation_id, membership_id, company_id, can_post) values ($1, $2, $3, true)`, [c.id, m.membershipId, companyId]);
      await tx.query(
        `insert into app.conversation_members (conversation_id, membership_id, company_id, can_post)
         select $1, t.id, $2, ($3 <> 'announcement' or t.role <> 'employee') from app.memberships t where t.id = any($4)`,
        [c.id, companyId, b.kind, others],
      );
      return { id: c.id as string, existed: false };
    });
    return reply.status(conv.existed ? 200 : 201).send({ id: conv.id });
  });

  app.get('/companies/:companyId/conversations/:conversationId/messages', async (req) => {
    const a = actorOf(req);
    const { companyId, conversationId } = parse(companyIdParams('conversationId'), req.params);
    requireCompany(a, companyId);
    const q = parse(
      z.object({ before: z.string().datetime({ offset: true }).optional(), after: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    const rows = await db.asUser(a.userId, async (tx) => {
      const ok = (await tx.query(`select 1 from app.conversations where id = $1 and company_id = $2`, [conversationId, companyId])).rowCount;
      if (!ok) throw notFound(); // RLS hides conversations you are not a member of
      return (await tx.query(
        `select msg.id, msg.conversation_id, msg.sender_membership_id, p.full_name, msg.body, msg.created_at,
                (select count(*) from app.conversation_members cm where cm.conversation_id = msg.conversation_id
                   and cm.membership_id <> msg.sender_membership_id and cm.last_read_at >= msg.created_at)::int as read_by
           from app.messages msg join app.memberships sm on sm.id = msg.sender_membership_id join app.profiles p on p.user_id = sm.user_id
          where msg.conversation_id = $1 and ($2::timestamptz is null or msg.created_at < $2) and ($3::timestamptz is null or msg.created_at > $3)
          order by msg.created_at ${q.after ? 'asc' : 'desc'} limit $4`,
        [conversationId, q.before ?? null, q.after ?? null, q.limit],
      )).rows;
    });
    const items: Message[] = rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, senderMembershipId: r.sender_membership_id, senderName: r.full_name, body: r.body, createdAt: r.created_at, readBy: r.read_by }));
    return { items: q.after ? items : items.reverse() };
  });

  /** Idempotent: the client generates the message id, so offline retries never create duplicates. */
  app.post('/companies/:companyId/conversations/:conversationId/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { companyId, conversationId } = parse(companyIdParams('conversationId'), req.params);
    const m = requireCompany(a, companyId, 'messages.send');
    const b = parse(sendMessageSchema, req.body);
    const out = await db.asUser(a.userId, async (tx) => {
      const prior = (await tx.query(`select id, conversation_id, sender_membership_id, body, created_at from app.messages where id = $1`, [b.id])).rows[0];
      if (prior) {
        if (prior.sender_membership_id !== m.membershipId) throw badRequest('Message id already used.');
        return { msg: prior, duplicate: true, recipients: [] as string[] };
      }
      const ok = (await tx.query(`select kind from app.conversations where id = $1 and company_id = $2`, [conversationId, companyId])).rows[0];
      if (!ok) throw notFound();
      const msg = (await tx.query(
        `insert into app.messages (id, company_id, conversation_id, sender_membership_id, body, client_created_at) values ($1,$2,$3,$4,$5,$6)
         returning id, conversation_id, sender_membership_id, body, created_at`,
        [b.id, companyId, conversationId, m.membershipId, b.body, b.clientCreatedAt ?? null],
      )).rows[0];
      // Use the database timestamp directly (microsecond precision) for read markers.
      await tx.query(`update app.conversation_members set last_read_at = (select created_at from app.messages where id = $3) where conversation_id = $1 and membership_id = $2`, [conversationId, m.membershipId, msg.id]);
      const recipients = (await tx.query(
        `select mm.user_id from app.conversation_members cm join app.memberships mm on mm.id = cm.membership_id
          where cm.conversation_id = $1 and cm.membership_id <> $2 and mm.status = 'active'`,
        [conversationId, m.membershipId],
      )).rows.map((r) => r.user_id as string);
      await tx.query('set local role app_system');
      // Lock-screen text never includes message content.
      await notify(tx, { userIds: recipients, companyId, type: 'message.new', msg: { key: 'msg.new', vars: { name: a.fullName ?? '' } }, data: { conversationId, companyId }, dedupeKey: `message:${msg.id}` }, emit);
      await tx.query('set local role app_user');
      return { msg, duplicate: false, recipients };
    });
    const payload: Message = { id: out.msg.id, conversationId, senderMembershipId: m.membershipId, senderName: a.fullName ?? '', body: out.msg.body, createdAt: out.msg.created_at, readBy: 0 };
    if (!out.duplicate) emit(`conv:${conversationId}`, 'message:new', payload);
    return reply.status(out.duplicate ? 200 : 201).send(payload);
  });

  app.post('/companies/:companyId/conversations/:conversationId/read', async (req) => {
    const a = actorOf(req);
    const { companyId, conversationId } = parse(companyIdParams('conversationId'), req.params);
    const m = requireCompany(a, companyId);
    const { messageId } = parse(markReadSchema, req.body);
    const at = await db.asUser(a.userId, async (tx) => {
      const msg = (await tx.query(`select created_at from app.messages where id = $1 and conversation_id = $2`, [messageId, conversationId])).rows[0];
      if (!msg) throw notFound();
      await tx.query(
        `update app.conversation_members set last_read_at = greatest(coalesce(last_read_at, 'epoch'), (select created_at from app.messages where id = $3))
          where conversation_id = $1 and membership_id = $2`,
        [conversationId, m.membershipId, messageId],
      );
      return msg.created_at as Date;
    });
    emit(`conv:${conversationId}`, 'message:read', { conversationId, membershipId: m.membershipId, readAt: at });
    return { ok: true };
  });
}
