import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { feedbackSchema, feedbackStatusSchema, type FeedbackItem, type UploadTarget } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requirePlatform } from '../lib/actor';
import { auditSystemTx } from '../lib/audit';
import { notFound } from '../lib/errors';
import { ctx, idParam } from '../lib/http';
import { extFor } from '../services/storage';

/**
 * Product feedback: improvements, complaints and bug reports, typed or as a voice note,
 * with an optional screenshot. Read by Blue Collar platform staff (not by the company).
 */
const SELECT = `
  select f.*, p.email as user_email, p.full_name as user_name, c.name as company_name
    from app.feedback f join app.profiles p on p.user_id = f.user_id left join app.companies c on c.id = f.company_id`;
const map = (r: Record<string, any>): FeedbackItem => ({
  id: r.id, kind: r.kind, message: r.message ?? null, hasAudio: !!r.audio_path, hasScreenshot: !!r.screenshot_path,
  platform: r.platform, appVersion: r.app_version ?? null, locale: r.locale ?? null, status: r.status, adminNote: r.admin_note ?? null,
  userEmail: r.user_email, userName: r.user_name, companyName: r.company_name ?? null, createdAt: r.created_at,
});

export default async function feedbackRoutes(app: FastifyInstance) {
  const { db } = app.services;
  const storage = { signedUpload: (p: string) => app.services.storage.signedUpload(p), signedDownload: (p: string) => app.services.storage.signedDownload(p) };

  app.post('/feedback', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const a = actorOf(req);
    const b = parse(feedbackSchema, req.body);
    // Only attach a company the user actually belongs to.
    const companyId = b.companyId && a.memberships.some((m) => m.companyId === b.companyId) ? b.companyId : null;
    const id = crypto.randomUUID();
    const audioPath = b.audio ? `feedback/${id}/voice.${extFor(b.audio.contentType)}` : null;
    const shotPath = b.screenshot ? `feedback/${id}/screenshot.${extFor(b.screenshot.contentType)}` : null;
    const [audioUrl, shotUrl] = await Promise.all([audioPath ? storage.signedUpload(audioPath) : null, shotPath ? storage.signedUpload(shotPath) : null]);
    const message = b.message?.trim() || null;
    if (!message && !audioUrl) {
      // A voice-only note needs storage; tell the user to type instead.
      return reply.status(503).send({ error: { code: 'uploads_unavailable', message: 'Voice notes are not available right now. Please type your feedback.', requestId: req.id } });
    }
    await db.asSystem(async (tx) => {
      await tx.query(
        `insert into app.feedback (id, user_id, company_id, kind, message, audio_path, screenshot_path, platform, app_version, locale)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, a.userId, companyId, b.kind, message, audioUrl ? audioPath : null, shotUrl ? shotPath : null, b.platform, b.appVersion ?? null, a.locale],
      );
      await auditSystemTx(tx, { companyId, actorUserId: a.userId, action: `feedback.${b.kind}`, targetType: 'feedback', targetId: id, ...ctx(req) });
    });
    const uploads: { audio: UploadTarget | null; screenshot: UploadTarget | null } = {
      audio: audioUrl && b.audio ? { url: audioUrl, contentType: b.audio.contentType } : null,
      screenshot: shotUrl && b.screenshot ? { url: shotUrl, contentType: b.screenshot.contentType } : null,
    };
    return reply.status(201).send({ id, uploads });
  });

  /** The user's own feedback and its status. */
  app.get('/feedback/mine', async (req) => {
    const a = actorOf(req);
    const rows = await db.asSystem(async (tx) => (await tx.query(`${SELECT} where f.user_id = $1 order by f.created_at desc limit 50`, [a.userId])).rows);
    return { items: rows.map(map) };
  });

  // ---------- Platform staff inbox ----------
  app.get('/admin/feedback', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.feedback.view');
    const q = parse(z.object({ status: z.enum(['new', 'planned', 'done', 'closed', 'all']).default('all'), kind: z.enum(['improvement', 'complaint', 'bug', 'all']).default('all') }), req.query);
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `${SELECT} where ($1 = 'all' or f.status = $1) and ($2 = 'all' or f.kind = $2) order by f.created_at desc limit 300`, [q.status, q.kind])).rows);
    const counts = await db.asSystem(async (tx) => (await tx.query(`select status, count(*)::int as n from app.feedback group by status`)).rows);
    return { items: rows.map(map), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  app.get('/admin/feedback/:id/files', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.feedback.view');
    const { id } = parse(idParam, req.params);
    const row = await db.asSystem(async (tx) => (await tx.query(`select audio_path, screenshot_path from app.feedback where id = $1`, [id])).rows[0]);
    if (!row) throw notFound();
    const [audio, screenshot] = await Promise.all([
      row.audio_path ? storage.signedDownload(row.audio_path) : null,
      row.screenshot_path ? storage.signedDownload(row.screenshot_path) : null,
    ]);
    await db.asSystem((tx) => auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'feedback.files_viewed', targetType: 'feedback', targetId: id, ...ctx(req) }));
    return { audio, screenshot };
  });

  app.patch('/admin/feedback/:id', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.feedback.manage');
    const { id } = parse(idParam, req.params);
    const b = parse(feedbackStatusSchema, req.body);
    const row = await db.asSystem(async (tx) => {
      const r = await tx.query(`update app.feedback set status = $2, admin_note = case when $3::boolean then $4 else admin_note end where id = $1 returning id`,
        [id, b.status, b.adminNote !== undefined, b.adminNote ?? null]);
      if (!r.rowCount) throw notFound();
      await auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'feedback.updated', targetType: 'feedback', targetId: id, metadata: b, ...ctx(req) });
      return (await tx.query(`${SELECT} where f.id = $1`, [id])).rows[0];
    });
    return map(row);
  });
}
