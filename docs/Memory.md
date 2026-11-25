# Project memory (context for future work and AI agents)

## Decisions (see ADR/ for detail)
- Name **Blue Collar** (was Trade Shift). Domain **bluecollarshift.com** (bought 2026-11-25 on Vercel; replaced hafs-s.com — bluecollar.com was taken). Mobile bundle id `com.bluecollarshift.app` (cannot change after store release). Owner's own logo only.
- Web stays at repo root; added `server/`, `mobile/`, `shared/`, `docs/`. No monorepo restructure.
- Supabase = Auth + Postgres only. App tables in private schema `app`. No DigitalOcean Postgres unless measured need + approval.
- API: Node + TS + Fastify, modular monolith, Socket.IO, Docker on DigitalOcean.
- Mobile: Expo SDK 58, SQLite offline queue, foreground location only.
- No paid chat/SMS. Messaging text-only v1.
- Alberta rules: daily 8 h / weekly 44 h, greater of; averaging; owner configures but never below legal minimum.
- Security-question password reset removed; email recovery only. MFA required for platform admins.
- Releases = cumulative ZIP vs the original main-folder ZIP, with manifest + delete list.

## Conventions
- Money in cents (integers). Times stored UTC; displayed in company time zone (default America/Edmonton).
- Every client-created record (time events, messages) has a client UUID for idempotency.
- Never edit original attendance; write an adjustment.
- Errors: `{ error: { code, message, details? } }`.

## Gotchas found while building
- RLS helper functions must be wrapped `(select app.fn())::uuid[]` or queries get 30× slower.
- One zod copy per bundle (web dedupes; server detects ZodError by name).
- Expo module versions must match `expo/bundledNativeModules.json`; `react`/`react-dom` exact `19.3.0` for RN 0.88.
- Supabase transaction pooler (6543) is fine: the API only uses `set local` inside transactions.
- Vercel Hobby forbids commercial use.

## Owner
Arsh — developer, Alberta. Mac (M-series, 32 GB). Prefers short, step-by-step answers; documents as PDF.
