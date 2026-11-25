import {
  effectiveCompanyPermissions,
  DEFAULT_PLATFORM_PERMISSIONS,
  type CompanyPermission,
  type CompanyRole,
  type PlatformPermission,
  type PlatformRole,
  isAlwaysSiteScoped,
} from '@bluecollar/shared';
import type { AuthClaims } from '../auth';
import type { Db } from '../db';
import { forbidden, notFound, unauthorized } from './errors';

export interface ActorMembership {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyStatus: 'active' | 'suspended';
  role: CompanyRole;
  permissions: Set<CompanyPermission>;
  /** null = all sites; otherwise the only sites this member may manage. */
  siteScope: string[] | null;
}

export interface Actor {
  claims: AuthClaims;
  userId: string;
  email: string;
  fullName: string | null;
  locale: string;
  hasProfile: boolean;
  memberships: ActorMembership[];
  platform: { role: PlatformRole; permissions: Set<PlatformPermission>; status: string } | null;
}

interface CacheEntry {
  at: number;
  actor: Omit<Actor, 'claims'>;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 10_000;

/** Drop cached authorization data (call after any role/membership/staff change). */
export function invalidateActor(userId?: string) {
  if (!userId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(userId)) cache.delete(k);
}

export async function loadActor(db: Db, claims: AuthClaims): Promise<Actor> {
  const key = `${claims.userId}:${claims.sessionId ?? 'none'}:${claims.issuedAt}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.actor, claims };

  const result = await db.asSystem(async (tx) => {
    const { rows } = await tx.query(
      `select p.user_id, p.email, p.full_name, p.locale,
              ps.role as platform_role, ps.status as platform_status, p.sessions_revoked_at,
              us.first_seen_at as session_first_seen, us.revoked_at as session_revoked_at,
              coalesce(json_agg(json_build_object(
                'membershipId', m.id, 'companyId', c.id, 'companyName', c.name, 'companyStatus', c.status,
                'role', m.role, 'extra', m.extra_permissions, 'revoked', m.revoked_permissions,
                'sites', (select coalesce(json_agg(ms.site_id), '[]'::json) from app.membership_sites ms where ms.membership_id = m.id)
              ) order by c.name) filter (where m.id is not null), '[]') as memberships
         from app.profiles p
         left join app.platform_staff ps on ps.user_id = p.user_id
         left join app.user_sessions us on us.session_id = $2
         left join app.memberships m on m.user_id = p.user_id and m.status = 'active'
         left join app.companies c on c.id = m.company_id
        where p.user_id = $1
        group by p.user_id, ps.role, ps.status, us.first_seen_at, us.revoked_at`,
      [claims.userId, claims.sessionId],
    );
    const row = rows[0] as { session_first_seen: string | null } | undefined;
    // Record the session the first time we see it (used for "sign out everywhere").
    if (row && claims.sessionId && !row.session_first_seen) {
      await tx.query(
        `insert into app.user_sessions (session_id, user_id, aal) values ($1, $2, $3)
         on conflict (session_id) do nothing`,
        [claims.sessionId, claims.userId, claims.aal],
      );
    } else if (row && claims.sessionId) {
      await tx.query(`update app.user_sessions set last_seen_at = now(), aal = $2 where session_id = $1 and last_seen_at < now() - interval '5 minutes'`, [
        claims.sessionId,
        claims.aal,
      ]);
    }
    return rows[0] as
      | {
          email: string;
          full_name: string;
          locale: string;
          platform_role: PlatformRole | null;
          platform_status: string | null;
          sessions_revoked_at: string | null;
          session_first_seen: string | null;
          session_revoked_at: string | null;
          memberships: {
            membershipId: string;
            companyId: string;
            companyName: string;
            companyStatus: 'active' | 'suspended';
            role: CompanyRole;
            extra: string[];
            revoked: string[];
            sites: string[];
          }[];
        }
      | undefined;
  });

  if (result) {
    if (result.session_revoked_at) throw unauthorized('This session was signed out. Please sign in again.');
    const firstSeen = result.session_first_seen ? Date.parse(result.session_first_seen) : Date.now();
    if (result.sessions_revoked_at && firstSeen <= Date.parse(result.sessions_revoked_at))
      throw unauthorized('This session was signed out. Please sign in again.');
  }
  const actor: Omit<Actor, 'claims'> = {
    userId: claims.userId,
    email: result?.email ?? claims.email,
    fullName: result?.full_name ?? null,
    locale: result?.locale ?? 'en',
    hasProfile: !!result,
    memberships: (result?.memberships ?? [])
      .map((m) => ({
        membershipId: m.membershipId,
        companyId: m.companyId,
        companyName: m.companyName,
        companyStatus: m.companyStatus,
        role: m.role,
        permissions: effectiveCompanyPermissions(m.role, m.extra, m.revoked),
        siteScope: m.sites.length > 0 || isAlwaysSiteScoped(m.role) ? m.sites : null,
      })),
    platform:
      result?.platform_role && result.platform_status === 'active'
        ? {
            role: result.platform_role,
            permissions: new Set(DEFAULT_PLATFORM_PERMISSIONS[result.platform_role]),
            status: result.platform_status,
          }
        : null,
  };
  cache.set(key, { at: Date.now(), actor });
  if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
  return { ...actor, claims };
}

/**
 * Resolve the caller's membership in a company and require a permission.
 * Callers that are not members get 404 (do not reveal that the company exists).
 */
export function requireCompany(actor: Actor, companyId: string, permission?: CompanyPermission): ActorMembership {
  const m = actor.memberships.find((x) => x.companyId === companyId);
  if (!m) throw notFound();
  if (m.companyStatus === 'suspended') throw forbidden('This company account is suspended. Contact Blue Collar support.');
  if (permission && !m.permissions.has(permission)) throw forbidden();
  return m;
}

export function canAccessSite(m: ActorMembership, siteId: string | null): boolean {
  if (m.siteScope === null) return true;
  return siteId !== null && m.siteScope.includes(siteId);
}

export function requirePlatform(actor: Actor, permission: PlatformPermission) {
  if (!actor.platform) throw notFound();
  // Mandatory MFA for every platform staff action.
  if (actor.claims.aal !== 'aal2') throw forbidden('Multi-factor authentication is required for platform administration.');
  if (!actor.platform.permissions.has(permission)) throw forbidden();
  return actor.platform;
}
