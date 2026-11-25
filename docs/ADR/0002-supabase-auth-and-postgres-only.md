# ADR 0002 — Supabase for Auth + Postgres only
Status: accepted
**Context:** Owner wants a custom, fast DB and no lock-in; Supabase already in use.
**Decision:** Supabase Auth for identity; its Postgres as the only database. App tables in private schema `app`, reached only through our API (role `bc_api`). No Supabase Data API, Storage, Realtime or Edge Functions.
**Alternatives:** DigitalOcean Managed Postgres (+$15/mo, migration work) — rejected until a measured need.
**Consequences:** Leaving Supabase later = move Postgres (standard dump) + replace Auth (JWT verification is isolated in `server/src/auth.ts`).
