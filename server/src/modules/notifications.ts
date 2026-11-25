import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceTokenSchema } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { notFound } from '../lib/errors';
import { idParam } from '../lib/http';

export default async function notificationRoutes(app: FastifyInstance) {
  const { db } = app.services;

  app.get('/notifications', async (req) => {
    const a = actorOf(req);
    const q = parse(z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select id, type, title, body, data, read_at, created_at from app.notifications where user_id = $1 and ($2::boolean is not true or read_at is null)
          order by created_at desc limit $3`,
        [a.userId, q.unread === 'true', q.limit],
      )).rows,
    );
    const unread = await db.asUser(a.userId, async (tx) => (await tx.query(`select count(*)::int as n from app.notifications where user_id = $1 and read_at is null`, [a.userId])).rows[0].n);
    return { items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, data: r.data, readAt: r.read_at, createdAt: r.created_at })), unread };
  });

  app.post('/notifications/:id/read', async (req) => {
    const a = actorOf(req);
    const { id } = parse(idParam, req.params);
    const n = await db.asUser(a.userId, async (tx) => (await tx.query(`update app.notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2`, [id, a.userId])).rowCount);
    if (!n) throw notFound();
    return { ok: true };
  });

  app.post('/notifications/read-all', async (req) => {
    const a = actorOf(req);
    await db.asUser(a.userId, (tx) => tx.query(`update app.notifications set read_at = now() where user_id = $1 and read_at is null`, [a.userId]));
    return { ok: true };
  });

  app.post('/devices', async (req, reply) => {
    const a = actorOf(req);
    const b = parse(deviceTokenSchema, req.body);
    await db.asSystem(async (tx) => {
      // A token moves to the newest user signed in on that device.
      await tx.query(
        `insert into app.device_tokens (user_id, token, platform) values ($1, $2, $3)
         on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now(), disabled_at = null`,
        [a.userId, b.token, b.platform],
      );
    });
    return reply.status(204).send();
  });

  app.delete('/devices', async (req, reply) => {
    const a = actorOf(req);
    const { token } = parse(z.object({ token: z.string().max(200) }), req.body);
    await db.asUser(a.userId, (tx) => tx.query(`delete from app.device_tokens where token = $1 and user_id = $2`, [token, a.userId]));
    return reply.status(204).send();
  });
}
