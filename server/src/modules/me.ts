import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Me } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { invalidateActor } from '../lib/actor';
import { auditSystemTx } from '../lib/audit';
import { ctx } from '../lib/http';
import { notFound } from '../lib/errors';

export default async function meRoutes(app: FastifyInstance) {
  const { db } = app.services;

  app.get('/me', async (req) => {
    const a = actorOf(req);
    const me: Me & { needsOnboarding: boolean; mfaLevel: string } = {
      userId: a.userId,
      email: a.email,
      fullName: a.fullName ?? '',
      locale: a.locale,
      memberships: a.memberships.map((m) => ({
        membershipId: m.membershipId,
        companyId: m.companyId,
        companyName: m.companyName,
        companyStatus: m.companyStatus,
        role: m.role,
        permissions: [...m.permissions],
        siteScope: m.siteScope,
      })),
      platform: a.platform
        ? { role: a.platform.role, permissions: [...a.platform.permissions], mfaVerified: a.claims.aal === 'aal2' }
        : null,
      needsOnboarding: !a.hasProfile || (a.memberships.length === 0 && !a.platform),
      mfaLevel: a.claims.aal,
    };
    return me;
  });

  app.patch('/me', async (req) => {
    const a = actorOf(req);
    const body = parse(
      z.object({ fullName: z.string().trim().min(2).max(120).optional(), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional() }),
      req.body,
    );
    const row = await db.asUser(a.userId, async (tx) => {
      const { rows } = await tx.query(
        `update app.profiles set full_name = coalesce($2, full_name), locale = coalesce($3, locale)
          where user_id = $1 returning full_name, locale`,
        [a.userId, body.fullName ?? null, body.locale ?? null],
      );
      return rows[0];
    });
    if (!row) throw notFound();
    invalidateActor(a.userId);
    return { fullName: row.full_name, locale: row.locale };
  });

  app.get('/me/sessions', async (req) => {
    const a = actorOf(req);
    const rows = await db.asSystem(async (tx) =>
      (
        await tx.query(
          `select session_id, first_seen_at, last_seen_at, aal, revoked_at from app.user_sessions
            where user_id = $1 order by last_seen_at desc limit 50`,
          [a.userId],
        )
      ).rows,
    );
    return { items: rows.map((r) => ({ ...r, current: r.session_id === a.claims.sessionId })) };
  });

  // "Sign out everywhere" — every existing session is rejected from now on, including refreshed tokens.
  app.post('/me/sign-out-everywhere', async (req) => {
    const a = actorOf(req);
    await db.asSystem(async (tx) => {
      await tx.query(`update app.profiles set sessions_revoked_at = now() where user_id = $1`, [a.userId]);
      await tx.query(`update app.user_sessions set revoked_at = now(), revoked_by = $1 where user_id = $1 and revoked_at is null`, [a.userId]);
      await auditSystemTx(tx, { actorUserId: a.userId, action: 'auth.sign_out_everywhere', targetType: 'user', targetId: a.userId, ...ctx(req) });
    });
    invalidateActor(a.userId);
    return { ok: true };
  });
}
