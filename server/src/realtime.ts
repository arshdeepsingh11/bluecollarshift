import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { Services } from './app';
import { loadActor } from './lib/actor';

/**
 * Socket.IO is only the delivery channel — every message is already stored in PostgreSQL before
 * it is emitted. Connections are authenticated with the Supabase access token, and every room
 * subscription is authorised against the database.
 * Scaling to several API instances: add @socket.io/postgres-adapter (uses the same database, no new service).
 */
export function attachRealtime(server: HttpServer, services: Services) {
  const allowed = new Set(services.config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
  const io = new Server(server, {
    path: '/realtime',
    cors: { origin: (origin, cb) => cb(null, !origin || allowed.has(origin)), credentials: false },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });

  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      const claims = await services.verify(token);
      const actor = await loadActor(services.db, claims);
      socket.data.userId = actor.userId;
      socket.data.expiresAt = claims.expiresAt;
      await socket.join(`user:${actor.userId}`);
      for (const m of actor.memberships) {
        if (m.permissions.has('attendance.view')) await socket.join(`company:${m.companyId}:staff`);
      }
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const joinSchema = z.object({ conversationId: z.string().uuid() });

  io.on('connection', (socket) => {
    services.metrics.inc('realtime.connections');
    // Disconnect when the access token expires; the client reconnects with a fresh token.
    const ttl = Math.max(5_000, socket.data.expiresAt * 1000 - Date.now());
    const timer = setTimeout(() => socket.disconnect(true), Math.min(ttl, 2 ** 31 - 1));
    socket.on('disconnect', () => clearTimeout(timer));

    socket.on('conversation:join', async (payload: unknown, ack?: (r: { ok: boolean }) => void) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false });
      const ok = await services.db
        .asUser(socket.data.userId, async (tx) => (await tx.query(`select 1 from app.conversations where id = $1`, [parsed.data.conversationId])).rowCount)
        .catch(() => 0);
      if (ok) await socket.join(`conv:${parsed.data.conversationId}`);
      ack?.({ ok: !!ok });
    });
    socket.on('conversation:leave', (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (parsed.success) void socket.leave(`conv:${parsed.data.conversationId}`);
    });
    socket.on('typing', (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (parsed.success && socket.rooms.has(`conv:${parsed.data.conversationId}`)) {
        socket.to(`conv:${parsed.data.conversationId}`).emit('typing', { conversationId: parsed.data.conversationId, userId: socket.data.userId });
      }
    });
  });

  return io;
}
