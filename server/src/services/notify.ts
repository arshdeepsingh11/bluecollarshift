import type { Tx } from '../db';

export interface NotificationInput {
  userIds: string[];
  companyId: string | null;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Same key for the same user = only one notification (jobs can run twice safely). */
  dedupeKey: string;
  email?: boolean;
}

export type RealtimeEmit = (room: string, event: string, payload: unknown) => void;

/**
 * Create in-app notifications (and queue push/email). Must be called with a SYSTEM transaction
 * because notifications are addressed to other users.
 */
export async function notify(tx: Tx, n: NotificationInput, emit?: RealtimeEmit) {
  if (n.userIds.length === 0) return [];
  const { rows } = await tx.query<{ id: string; user_id: string; created_at: string }>(
    `insert into app.notifications (user_id, company_id, type, title, body, data, dedupe_key, email_status)
     select u, $2, $3, $4, $5, $6, $7, $8 from unnest($1::uuid[]) u
     on conflict (user_id, dedupe_key) do nothing
     returning id, user_id, created_at`,
    [n.userIds, n.companyId, n.type, n.title, n.body, JSON.stringify(n.data ?? {}), n.dedupeKey, n.email ? 'pending' : 'skipped'],
  );
  if (emit) {
    for (const r of rows) {
      emit(`user:${r.user_id}`, 'notification:new', {
        id: r.id, type: n.type, title: n.title, body: n.body, data: n.data ?? {}, createdAt: r.created_at, readAt: null,
      });
    }
  }
  return rows;
}

/** User ids of active staff in a company holding any of the given roles (optionally scoped to a site). */
export async function staffUserIds(tx: Tx, companyId: string, roles: string[], siteId?: string | null): Promise<string[]> {
  const { rows } = await tx.query<{ user_id: string }>(
    `select m.user_id from app.memberships m
      where m.company_id = $1 and m.status = 'active' and m.role = any($2)
        and ($3::uuid is null or m.role in ('owner','admin','payroll')
             or not exists (select 1 from app.membership_sites s where s.membership_id = m.id)
             or exists (select 1 from app.membership_sites s where s.membership_id = m.id and s.site_id = $3))`,
    [companyId, roles, siteId ?? null],
  );
  return rows.map((r) => r.user_id);
}
