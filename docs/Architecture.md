# Architecture

## 1. Overview
```
 Browser (bluecollarshift.com / app. / admin.)  ──HTTPS──►  Vercel (static, prerendered public pages)
 Phone (Expo app, SQLite offline queue) ─┐
 Web app ────────────────────────────────┼─HTTPS/WSS─► API: Node 22 + Fastify + Socket.IO (Docker, DigitalOcean)
                                         │                 │  bc_api role, TLS, pooler (transaction mode)
 Supabase Auth (login, MFA, recovery) ◄──┘                 ▼
                                               Supabase Postgres (schema `app`, RLS)
                                         Resend (email) · Expo Push (APNs/FCM) · Google Maps (restricted keys)
```
- **Modular monolith.** One API process; modules in `server/src/modules/*`.
- **Supabase = Auth + Postgres only.** App tables live in private schema `app` — not exposed through the Supabase Data API. Clients never query the DB directly.
- **Shared package** `shared/` — permissions, zod contracts, Alberta payroll engine, time and sync helpers. Used by API, web and mobile.

## 2. Repository layout
| Path | What |
|---|---|
| `/` (root) | Web app (React 19, Vite 8, TS) — kept at root as before |
| `server/` | API, jobs, realtime, tests, Dockerfile |
| `mobile/` | Expo app (expo-router, expo-sqlite, location, notifications) |
| `shared/` | Shared TypeScript |
| `supabase/migrations/` | Ordered SQL migrations |
| `docs/` | This documentation + ADRs |

## 3. Request path
1. Client sends `Authorization: Bearer <Supabase access token>`.
2. API verifies JWT (issuer, audience, expiry, signature via JWKS).
3. `loadActor` loads profile, memberships, platform role, checks session revocation (cached 10 s).
4. Route checks company membership + permission (`requireCompany`, `requirePlatform`).
5. Query runs in a transaction as `app_user` with the user's id → **RLS enforces again**.
6. Writes that matter are audit-logged in the same transaction.

## 4. Data integrity
- Composite FKs `(id, company_id)`.
- `time_events` insert trigger pairs events into `work_sessions` (server time when online; device time when offline, bounded to 14 days back / 2 min ahead).
- Adjustments are separate rows; `work_sessions_effective` view shows final values.
- Optimistic `version` on shifts and sessions → HTTP 409 on conflict.

## 5. Offline (mobile)
Event → SQLite (`saved`) → `pending` → server → `synced | needs_review | rejected`.
UUID per event = idempotent retries. Backoff 5 s × 3ⁿ (max 15 min). Triggers: reconnect, app foreground, every 60 s, OS background task (≥15 min). Nothing is deleted automatically.

## 6. Realtime
Socket.IO at `/realtime`, token auth, rooms: `user:<id>`, `company:<id>:staff`, `conv:<id>` (join verified against DB). Disconnects when the token expires. Single instance now; Postgres-backed adapter or sticky sessions needed only when scaling to >1 API instance.

## 7. Background jobs
In-process scheduler with Postgres advisory locks (safe with multiple instances) and `job_runs` history: late shifts, missing clock-outs, shift reminders, push delivery, email delivery.

## 8. Scaling path (only when measured)
1. Bigger droplet / 2 instances behind DO load balancer.
2. Supabase compute upgrade.
3. Read replica for reports.
Decisions recorded in `docs/ADR/`.
