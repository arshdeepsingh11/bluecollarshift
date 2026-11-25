import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { siteSchema, updateSiteSchema, type JobSite } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { canAccessSite, requireCompany } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx } from '../lib/http';

const COLS = `id, name, address, lat, lng, geofence_radius_m, notes, status, starts_on, ends_on`;
const map = (r: Record<string, unknown>): JobSite => ({
  id: r.id as string, name: r.name as string, address: (r.address as string) ?? null, lat: (r.lat as number) ?? null,
  lng: (r.lng as number) ?? null, geofenceRadiusM: (r.geofence_radius_m as number) ?? null, notes: (r.notes as string) ?? null,
  status: r.status as JobSite['status'], startsOn: (r.starts_on as string) ?? null, endsOn: (r.ends_on as string) ?? null,
});

export default async function siteRoutes(app: FastifyInstance) {
  const { db } = app.services;

  app.get('/companies/:companyId/sites', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId);
    const { status } = parse(z.object({ status: z.enum(['active', 'archived', 'all']).default('active') }), req.query);
    // Employees see only sites they are assigned to; supervisors only their scoped sites (enforced by RLS).
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(`select ${COLS} from app.job_sites where company_id = $1 and ($2 = 'all' or status = $2) order by name`, [companyId, status])).rows,
    );
    return { items: rows.map(map) };
  });

  app.get('/companies/:companyId/sites/:siteId', async (req) => {
    const a = actorOf(req);
    const { companyId, siteId } = parse(companyIdParams('siteId'), req.params);
    requireCompany(a, companyId);
    const row = await db.asUser(a.userId, async (tx) => (await tx.query(`select ${COLS} from app.job_sites where id = $1 and company_id = $2`, [siteId, companyId])).rows[0]);
    if (!row) throw notFound();
    return map(row);
  });

  app.post('/companies/:companyId/sites', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'sites.manage');
    const b = parse(siteSchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const { rows } = await tx.query(
        `insert into app.job_sites (company_id, name, address, lat, lng, geofence_radius_m, notes, starts_on, ends_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`,
        [companyId, b.name, b.address ?? null, b.lat ?? null, b.lng ?? null, b.geofenceRadiusM ?? null, b.notes ?? null, b.startsOn ?? null, b.endsOn ?? null],
      );
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'site.created', targetType: 'job_site', targetId: rows[0].id, ...ctx(req) });
      return rows[0];
    });
    return reply.status(201).send(map(row));
  });

  app.patch('/companies/:companyId/sites/:siteId', async (req) => {
    const a = actorOf(req);
    const { companyId, siteId } = parse(companyIdParams('siteId'), req.params);
    const m = requireCompany(a, companyId, 'sites.manage');
    if (!canAccessSite(m, siteId)) throw notFound();
    const b = parse(updateSiteSchema, req.body);
    const set = (k: keyof typeof b) => b[k] !== undefined;
    const row = await db.asUser(a.userId, async (tx) => {
      const { rows } = await tx.query(
        `update app.job_sites set
           name = coalesce($3, name),
           address = case when $4 then $5 else address end,
           lat = case when $6 then $7 else lat end,
           lng = case when $6 then $8 else lng end,
           geofence_radius_m = case when $9 then $10 else geofence_radius_m end,
           notes = case when $11 then $12 else notes end,
           status = coalesce($13, status),
           starts_on = case when $14 then $15::date else starts_on end,
           ends_on = case when $16 then $17::date else ends_on end
         where id = $1 and company_id = $2 returning ${COLS}`,
        [siteId, companyId, b.name ?? null, set('address'), b.address ?? null, set('lat') || set('lng'), b.lat ?? null, b.lng ?? null,
          set('geofenceRadiusM'), b.geofenceRadiusM ?? null, set('notes'), b.notes ?? null, b.status ?? null,
          set('startsOn'), b.startsOn ?? null, set('endsOn'), b.endsOn ?? null],
      );
      if (!rows[0]) throw notFound();
      await auditTx(tx, { companyId, actorUserId: a.userId, action: b.status === 'archived' ? 'site.archived' : 'site.updated', targetType: 'job_site', targetId: siteId, metadata: b, ...ctx(req) });
      return rows[0];
    });
    return map(row);
  });
}
