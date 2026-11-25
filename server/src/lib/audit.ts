import type { Db, Tx } from '../db';

export interface AuditEntry {
  companyId?: string | null;
  actorUserId?: string | null;
  actorType?: 'user' | 'platform' | 'system';
  action: string;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
  success?: boolean;
}

const SENSITIVE_KEYS = /pass|token|secret|authorization|cookie|answer/i;

/** Remove secrets before anything is written to logs (Checklist §15: never log tokens or passwords). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

const INSERT = `insert into app.audit_logs
  (company_id, actor_user_id, actor_type, action, target_type, target_id, metadata, ip, request_id, success)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

function params(e: AuditEntry) {
  return [
    e.companyId ?? null,
    e.actorUserId ?? null,
    e.actorType ?? 'user',
    e.action,
    e.targetType ?? null,
    e.targetId ?? null,
    JSON.stringify(redact(e.metadata ?? {})),
    e.ip ?? null,
    e.requestId ?? null,
    e.success ?? true,
  ];
}

/** Write an audit record inside an existing transaction (commits/rolls back with the change). */
export async function auditTx(tx: Tx, e: AuditEntry) {
  await tx.query('set local role app_system');
  try {
    await tx.query(INSERT, params(e));
  } finally {
    await tx.query('set local role app_user').catch(() => undefined);
  }
}

/** Write an audit record in the system transaction (use inside db.asSystem). */
export async function auditSystemTx(tx: Tx, e: AuditEntry) {
  await tx.query(INSERT, params(e));
}

/** Write an audit record independently (e.g. for DENIED actions, which roll back the main transaction). */
export async function auditDetached(db: Db, e: AuditEntry) {
  await db.asSystem((tx) => tx.query(INSERT, params(e))).catch(() => undefined);
}

export async function securityEvent(
  db: Db,
  e: { userId?: string | null; type: string; severity?: 'info' | 'warning' | 'critical'; ip?: string | null; metadata?: Record<string, unknown> },
) {
  await db
    .asSystem((tx) =>
      tx.query(`insert into app.security_events (user_id, type, severity, ip, metadata) values ($1, $2, $3, $4, $5)`, [
        e.userId ?? null,
        e.type,
        e.severity ?? 'info',
        e.ip ?? null,
        JSON.stringify(redact(e.metadata ?? {})),
      ]),
    )
    .catch(() => undefined);
}
