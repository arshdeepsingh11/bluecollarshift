import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { closeSafetySchema, safetyReportSchema, toolboxTalkSchema, type SafetyReport, type ToolboxTalk } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { canAccessSite, requireCompany } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx } from '../lib/http';
import { notify, staffUserIds } from '../services/notify';
import { extFor } from '../services/storage';

const REPORT_SELECT = `
  select r.*, js.name as site_name, p.full_name as reporter
    from app.safety_reports r left join app.job_sites js on js.id = r.site_id
    join app.memberships m on m.id = r.reported_by_membership_id join app.profiles p on p.user_id = m.user_id`;
const mapReport = (r: Record<string, any>): SafetyReport => ({
  id: r.id, kind: r.kind, siteId: r.site_id ?? null, siteName: r.site_name ?? null, occurredAt: r.occurred_at, description: r.description,
  injured: r.injured, injuryDetails: r.injury_details ?? null, actionTaken: r.action_taken ?? null, hasPhoto: !!r.photo_path,
  reportedBy: r.reporter, status: r.status, closeNote: r.close_note ?? null, createdAt: r.created_at,
});

export default async function safetyRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;
  const storage = { signedUpload: (p: string) => app.services.storage.signedUpload(p), signedDownload: (p: string) => app.services.storage.signedDownload(p) };

  /** Anyone in the company can report an incident, near miss or hazard. */
  app.post('/companies/:companyId/safety/reports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(safetyReportSchema, req.body);
    if (Date.parse(b.occurredAt) > Date.now() + 5 * 60_000) throw badRequest('The date cannot be in the future.');
    const id = crypto.randomUUID();
    const photoPath = b.photo ? `safety/${companyId}/${id}.${extFor(b.photo.contentType)}` : null;
    const upload = photoPath ? await storage.signedUpload(photoPath) : null;
    const row = await db.asUser(a.userId, async (tx) => {
      if (b.siteId) {
        const site = (await tx.query(`select 1 from app.job_sites where id = $1 and company_id = $2`, [b.siteId, companyId])).rowCount;
        if (!site) throw badRequest('Unknown job site.');
      }
      await tx.query(
        `insert into app.safety_reports (id, company_id, kind, site_id, occurred_at, description, injured, injury_details, action_taken, photo_path, reported_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, companyId, b.kind, b.siteId ?? null, b.occurredAt, b.description, b.injured, b.injuryDetails ?? null, b.actionTaken ?? null,
          upload ? photoPath : null, m.membershipId],
      );
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `safety.${b.kind}_reported`, targetType: 'safety_report', targetId: id, metadata: { injured: b.injured }, ...ctx(req) });
      await tx.query('set local role app_system');
      const staff = await staffUserIds(tx, companyId, ['owner', 'admin', 'manager', 'supervisor'], b.siteId ?? null);
      const key = b.injured ? 'safety.injury' : b.kind === 'incident' ? 'safety.incident' : b.kind === 'near_miss' ? 'safety.near_miss' : 'safety.hazard';
      await notify(tx, { userIds: staff.filter((u) => u !== a.userId), companyId, type: 'safety.reported', msg: { key, vars: { name: a.fullName ?? '', text: b.description.slice(0, 140) } },
        data: { reportId: id, companyId }, dedupeKey: `safety:${id}`, email: b.injured }, emit);
      const r = (await tx.query(`${REPORT_SELECT} where r.id = $1`, [id])).rows[0];
      await tx.query('set local role app_user');
      return r;
    });
    return reply.status(201).send({ ...mapReport(row), photoUpload: upload && b.photo ? { url: upload, contentType: b.photo.contentType } : null });
  });

  app.get('/companies/:companyId/safety/reports', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const q = parse(z.object({ status: z.enum(['open', 'closed', 'all']).default('all') }), req.query);
    const mineOnly = !m.permissions.has('safety.manage');
    const rows = await db.asUser(a.userId, async (tx) => (await tx.query(
      `${REPORT_SELECT} where r.company_id = $1 and ($2 = 'all' or r.status = $2) and (not $3 or r.reported_by_membership_id = $4)
       order by r.created_at desc limit 300`,
      [companyId, q.status, mineOnly, m.membershipId],
    )).rows);
    return { items: rows.filter((r) => !m.siteScope || !r.site_id || canAccessSite(m, r.site_id)).map(mapReport) };
  });

  app.get('/companies/:companyId/safety/reports/:reportId/photo', async (req) => {
    const a = actorOf(req);
    const { companyId, reportId } = parse(companyIdParams('reportId'), req.params);
    requireCompany(a, companyId);
    const row = await db.asUser(a.userId, async (tx) => (await tx.query(`select photo_path from app.safety_reports where id = $1 and company_id = $2`, [reportId, companyId])).rows[0]);
    if (!row?.photo_path) throw notFound();
    const url = await storage.signedDownload(row.photo_path);
    if (!url) throw notFound('Photo is not available.');
    return { url };
  });

  app.post('/companies/:companyId/safety/reports/:reportId/close', async (req) => {
    const a = actorOf(req);
    const { companyId, reportId } = parse(companyIdParams('reportId'), req.params);
    requireCompany(a, companyId, 'safety.manage');
    const b = parse(closeSafetySchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(`update app.safety_reports set status = 'closed', closed_by = $3, closed_at = now(), close_note = $4
                                 where id = $1 and company_id = $2 and status = 'open' returning id`, [reportId, companyId, a.userId, b.note]);
      if (!r.rowCount) throw conflict('This report is already closed or was not found.');
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'safety.closed', targetType: 'safety_report', targetId: reportId, ...ctx(req) });
      return (await tx.query(`${REPORT_SELECT} where r.id = $1`, [reportId])).rows[0];
    });
    return mapReport(row);
  });

  // ---------- Toolbox talks ----------
  const loadTalks = async (tx: import('../db').Tx, companyId: string, membershipId: string, all: boolean, onlyId?: string): Promise<ToolboxTalk[]> => {
    const rows = (await tx.query(
      `select t.id, t.topic, t.notes, t.held_at, js.name as site_name, lp.full_name as led_by,
              coalesce((select json_agg(json_build_object('membershipId', ta.membership_id, 'fullName', ap.full_name, 'signedAt', ta.signed_at) order by ap.full_name)
                          from app.toolbox_talk_attendees ta join app.memberships am on am.id = ta.membership_id join app.profiles ap on ap.user_id = am.user_id
                         where ta.talk_id = t.id), '[]') as attendees
         from app.toolbox_talks t left join app.job_sites js on js.id = t.site_id
         join app.memberships lm on lm.id = t.led_by_membership_id join app.profiles lp on lp.user_id = lm.user_id
        where t.company_id = $1 and ($4::uuid is null or t.id = $4)
          and ($3 or t.led_by_membership_id = $2 or exists (select 1 from app.toolbox_talk_attendees x where x.talk_id = t.id and x.membership_id = $2))
        order by t.held_at desc limit 200`,
      [companyId, membershipId, all, onlyId ?? null],
    )).rows;
    return rows.map((r) => ({ id: r.id, topic: r.topic, notes: r.notes, siteName: r.site_name, heldAt: r.held_at, ledBy: r.led_by, attendees: r.attendees }));
  };

  app.post('/companies/:companyId/safety/talks', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(toolboxTalkSchema, req.body);
    const talk = await db.asUser(a.userId, async (tx) => {
      if (!m.permissions.has('safety.manage')) {
        const lead = (await tx.query(`select crew_lead from app.memberships where id = $1`, [m.membershipId])).rows[0];
        if (!lead?.crew_lead) throw forbidden('Only supervisors and crew leads can record a toolbox talk.');
      }
      await tx.query('set local role app_system');
      const valid = (await tx.query(`select id, user_id from app.memberships where company_id = $1 and status = 'active' and id = any($2)`, [companyId, b.attendeeIds])).rows;
      if (valid.length !== new Set(b.attendeeIds).size) throw badRequest('One or more attendees are not active members.');
      if (b.siteId && !(await tx.query(`select 1 from app.job_sites where id = $1 and company_id = $2`, [b.siteId, companyId])).rowCount) throw badRequest('Unknown job site.');
      await tx.query('set local role app_user');
      const t = (await tx.query(
        `insert into app.toolbox_talks (company_id, site_id, topic, notes, held_at, led_by_membership_id) values ($1,$2,$3,$4,$5,$6) returning id`,
        [companyId, b.siteId ?? null, b.topic, b.notes ?? null, b.heldAt, m.membershipId],
      )).rows[0];
      await tx.query(`insert into app.toolbox_talk_attendees (talk_id, membership_id, company_id, signed_at)
                      select $1, x, $2, case when x = $4 then now() else null end from unnest($3::uuid[]) x`, [t.id, companyId, b.attendeeIds, m.membershipId]);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'safety.talk_recorded', targetType: 'toolbox_talk', targetId: t.id, metadata: { attendees: b.attendeeIds.length }, ...ctx(req) });
      await tx.query('set local role app_system');
      await notify(tx, { userIds: valid.map((v) => v.user_id as string).filter((u) => u !== a.userId), companyId, type: 'safety.talk', msg: { key: 'safety.talk', vars: { text: b.topic } }, data: { talkId: t.id, companyId }, dedupeKey: `talk:${t.id}` }, emit);
      await tx.query('set local role app_user');
      return (await loadTalks(tx, companyId, m.membershipId, true, t.id))[0]!;
    });
    return reply.status(201).send(talk);
  });

  app.get('/companies/:companyId/safety/talks', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const items = await db.asUser(a.userId, (tx) => loadTalks(tx, companyId, m.membershipId, m.permissions.has('safety.manage')));
    return { items };
  });

  /** An attendee signs that they attended (on their own account only). */
  app.post('/companies/:companyId/safety/talks/:talkId/sign', async (req) => {
    const a = actorOf(req);
    const { companyId, talkId } = parse(companyIdParams('talkId'), req.params);
    const m = requireCompany(a, companyId);
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(`update app.toolbox_talk_attendees set signed_at = now() where talk_id = $1 and membership_id = $2 and signed_at is null returning talk_id`, [talkId, m.membershipId]);
      if (!r.rowCount) throw notFound('Nothing to sign.');
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'safety.talk_signed', targetType: 'toolbox_talk', targetId: talkId, ...ctx(req) });
    });
    return { ok: true };
  });
}
