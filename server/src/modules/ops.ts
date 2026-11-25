import type { FastifyInstance } from 'fastify';
import { actorOf } from '../app';
import { requirePlatform } from '../lib/actor';

export default async function opsRoutes(app: FastifyInstance) {
  const { db, metrics } = app.services;

  /** Operational metrics for the platform team (API latency, errors, job health, DB latency). */
  app.get('/ops/metrics', async (req) => {
    requirePlatform(actorOf(req), 'platform.security.view');
    const dbLatencyMs = await db.ping().catch(() => -1);
    const pool = { total: db.pool.totalCount, idle: db.pool.idleCount, waiting: db.pool.waitingCount };
    return { ...metrics.snapshot(), database: { latencyMs: dbLatencyMs, pool } };
  });

  /** Public client config: minimum supported mobile version and maintenance flag. */
  app.get('/config', { config: { public: true } }, async () => {
    const rows = await db.asSystem(async (tx) => (await tx.query(`select key, value from app.platform_settings where key in ('maintenance_mode', 'min_mobile_version')`)).rows);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { maintenanceMode: map.maintenance_mode === true, minMobileVersion: (map.min_mobile_version as string) ?? '1.0.0' };
  });
}
