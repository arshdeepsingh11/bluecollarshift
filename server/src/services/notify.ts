import type { Tx } from '../db';
import { normalizeLocale, render, type Locale, type MessageKey, type Vars } from '../i18n/messages';

export interface NotificationInput {
  userIds: string[];
  companyId: string | null;
  type: string;
  /** Translated per recipient. `text` (typed by a person) replaces the body as-is. */
  msg: { key: MessageKey; vars?: Vars; text?: string | null };
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
  const userIds = [...new Set(n.userIds)];
  if (userIds.length === 0) return [];
  // Each person reads it in their own language; dates in the company's time zone.
  const people = (await tx.query<{ user_id: string; locale: string }>(`select user_id, locale from app.profiles where user_id = any($1)`, [userIds])).rows;
  const tz = n.companyId
    ? ((await tx.query<{ timezone: string }>(`select timezone from app.companies where id = $1`, [n.companyId])).rows[0]?.timezone ?? 'UTC')
    : 'UTC';
  const groups = new Map<Locale, string[]>();
  for (const u of userIds) {
    const loc = normalizeLocale(people.find((p) => p.user_id === u)?.locale);
    groups.set(loc, [...(groups.get(loc) ?? []), u]);
  }
  const all: { id: string; user_id: string; created_at: string; title: string; body: string }[] = [];
  for (const [loc, ids] of groups) {
    const text = render(n.msg.key, n.msg.vars ?? {}, loc, tz);
    const body = n.msg.text?.trim() ? n.msg.text.trim().slice(0, 1000) : text.body.slice(0, 1000);
    const title = text.title.slice(0, 200);
    const { rows } = await tx.query<{ id: string; user_id: string; created_at: string }>(
      `insert into app.notifications (user_id, company_id, type, title, body, data, dedupe_key, email_status)
       select u, $2, $3, $4, $5, $6, $7, $8 from unnest($1::uuid[]) u
       on conflict (user_id, dedupe_key) do nothing
       returning id, user_id, created_at`,
      [ids, n.companyId, n.type, title, body, JSON.stringify(n.data ?? {}), n.dedupeKey, n.email ? 'pending' : 'skipped'],
    );
    for (const r of rows) all.push({ ...r, title, body });
  }
  if (emit) {
    for (const r of all) {
      emit(`user:${r.user_id}`, 'notification:new', {
        id: r.id, type: n.type, title: r.title, body: r.body, data: n.data ?? {}, createdAt: r.created_at, readAt: null,
      });
    }
  }
  return all;
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
