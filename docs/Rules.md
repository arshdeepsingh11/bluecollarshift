# Blue Collar — Engineering Rules

## RULE 1 — NO TRUST BY DEFAULT
- Every request is authenticated (Supabase JWT, verified with JWKS) and authorized on the server.
- The browser and the phone are untrusted. They never decide roles, company, pay, time or permissions.
- Database access runs as the user (`app_user` + RLS). `app_system` is used only for named trusted jobs.
- Client input is validated with shared zod schemas. Unknown fields are ignored; sizes are capped.

## RULE 2 — NO SINGLE POINT OF SECURITY FAILURE
- Two layers for every tenant rule: API check **and** Row Level Security in Postgres.
- Composite foreign keys `(id, company_id)` stop cross-company links even if code is wrong.
- Append-only triggers on time events, adjustments, audit logs, security events, pay rates and messages.
- Platform admins need MFA (aal2) and re-authentication within 10 minutes for critical actions.
- Secrets live only in environment variables of the server. Never in web, mobile or git.

## RULE 3 — EVERYTHING MUST BE VERIFIED
- No feature is "done" without automated tests that prove it, including the failure cases.
- Test results are recorded as actually measured (`docs/Testing.md`). Untested = "not verified".
- Performance claims come from measurements (`server/tests/perf/results-*.json`).
- Every migration has a rollback note and is tested on a fresh database before any real project.

## Working rules
1. Never commit `.env`, keys, certificates or `node_modules`.
2. Never overwrite `.env` files or production configuration.
3. Never silently delete files or database records. Deletions are listed in the release manifest.
4. Never expose the Supabase service-role/secret key to browser or mobile apps.
5. Do not build our own authentication. Supabase Auth only.
6. No purchase, plan upgrade or database migration to a new provider without owner approval.
7. Experimental migrations go to the development Supabase project only — never production.
8. Original clock-in/out data is never edited. Changes are separate adjustment rows with reason + author.
9. Paid payroll is immutable. Corrections happen in a later period.
10. Payroll settings are the company's own policy. The app never teaches or enforces a jurisdiction's law; it only rejects impossible values (API **and** DB bounds). Changed in Release A (ADR 0008).
11. Keep infrastructure light: no Redis/Kafka/Kubernetes/microservices unless measurement shows the need.
12. All user-facing text goes through translation keys (`src/i18n/en.ts`, `mobile/src/i18n.ts`).
13. Releases are cumulative ZIPs with a manifest (new / modified / deleted files).
