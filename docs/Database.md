# Database

Supabase Postgres (dev project `zrrqixdqrsjbetltaqcd`; production = separate project, created later).
Migrations: `supabase/migrations/` (run in file-name order). Rollback: `supabase/ROLLBACK.md`.

## 1. Migrations
| File | Purpose |
|---|---|
| `20261125000100_quarantine_legacy.sql` | Moves the July-2026 tables/functions/types into schema `legacy`, revokes client access. **Data is kept.** |
| `20261125000200_core_schema.sql` | Roles, schema `app`, 28 tables, constraints, 33 indexes |
| `20261125000300_functions_triggers.sql` | RLS helper functions, 10 triggers, `work_sessions_effective` view |
| `20261125000400_rls_and_grants.sql` | Grants + 83 RLS policies |

## 2. Roles
| Role | Login | Use |
|---|---|---|
| `bc_api` | yes (password set manually) | The API's connection user. NOINHERIT; switches to one of the two below per transaction |
| `app_user` | no | Normal requests. RLS applies with `request.jwt.claims.sub` = user id |
| `app_system` | no | Trusted jobs (notifications, invites, audit). Explicit policies only |
| `anon`, `authenticated` | Supabase | **No access** to `app` or `legacy` |

## 3. Tables (schema `app`)
- **Identity:** `profiles` (user_id = auth.users.id, `sessions_revoked_at`), `user_sessions`, `platform_staff`.
- **Tenancy:** `companies`, `memberships` (role, status, job title), `membership_sites` (supervisor scope), `invitations` (sha-256 token hash).
- **Work:** `job_sites` (lat/lng/radius), `shifts` (version), `shift_assignments`.
- **Attendance:** `time_events` (append-only), `work_sessions`, `adjustments` (append-only), `disputes`.
- **Pay:** `pay_rates` (append-only, effective dates), `payroll_settings` (Alberta minimum CHECK), `pay_periods`, `payroll_records`.
- **Messaging:** `conversations` (`direct_key` unique), `conversation_members` (last_read_at), `messages` (append-only, `attachments` jsonb reserved).
- **Notify:** `notifications` (dedupe_key, push/email status), `device_tokens`.
- **Ops/Security:** `audit_logs`, `security_events` (both append-only), `support_access_grants`, `job_runs`, `platform_settings`.

## 4. Key rules in the database
- Composite FKs `(id, company_id)` on all child tables.
- Unique: one open work session per membership; one direct conversation per pair; event id (idempotency).
- `tg_time_event_apply`: validates sequence, computes occurred_at, distance to site, flags (`outside_geofence`, `no_location`, `low_accuracy`, `late_sync`, `out_of_order`, `duplicate`), opens/closes sessions.
- Payroll guards: approved/paid records cannot change; paid periods locked.

## 5. Performance (measured 2026-11-25, seed: 400 companies, 10,400 people, 403,200 sessions, 806,400 events)
| Query | Before | After |
|---|---|---|
| Q1 manager timesheets (1 week) | 225 ms | 6.6 ms |
| Q2 employee open session | — | 0.017 ms |
| Q3 live attendance | 29 ms | 0.7 ms |
| Q4 messages page | — | ~0.4 ms |
Fix: RLS helpers return arrays once per query: `col = any ((select app.my_companies())::uuid[])` (InitPlan) instead of a per-row function call. Scripts: `server/tests/perf/`.

## 6. Live dev project status
**Not yet inspected/migrated.** The Supabase connector in this session has no access to project `zrrqixdqrsjbetltaqcd`. All migrations were verified on a local Postgres 16 with a Supabase emulation (`server/tests/fixtures/supabase-emulation.sql`) plus the original `supabase/schema.sql`, `rls_policies.sql`, `employee_invites.sql`. Procedure for the live dev project: `supabase/README.md`.
