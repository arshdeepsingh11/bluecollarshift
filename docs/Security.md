# Security

Target: OWASP ASVS 4.0 Level 2 (self-assessed). **No certification is claimed.**

## 1. Threat model (STRIDE, short)
| Threat | Example | Controls |
|---|---|---|
| Spoofing | Stolen/forged token | Supabase Auth; JWT signature (JWKS), issuer, audience, expiry checked; session revocation table; sign-out everywhere |
| Tampering | Employee edits own hours / backdates clock | Server decides time when online; offline device time bounded (−14 d / +2 min) and flagged; original events append-only; adjustments by staff only with reason |
| Repudiation | "I never changed that" | Audit log (append-only) on every important write with actor, IP, before/after (redacted) |
| Info disclosure | Company A reads company B | API membership checks + RLS + composite FKs; 404 not 403 for hidden rows; app schema not exposed to Supabase Data API |
| DoS | Flooding sync or login | Rate limits (global + per route), body limit, batch max 200, statement timeout, zod 4.x (memory DoS fix) |
| Elevation | Manager makes self owner; staff abuses admin | Role rank checks (`canAssignRole`), owner-only actions, admin MFA (aal2) + recent auth (10 min), time-boxed support access with reason, alerts |

## 2. Authentication
- Supabase Auth only (email + password, email confirmation, reset by email link). Old security-question reset **removed**.
- Platform admins: TOTP MFA required (aal2). Critical admin actions: re-auth within 10 min.
- Web: PKCE flow; tokens in Supabase client storage. Mobile: tokens in Keychain/Keystore (expo-secure-store, chunked).
- Session tracking by Supabase `session_id`; `POST /me/sign-out-everywhere` and admin revoke invalidate within ≤10 s (actor cache).

## 3. Authorization
- Permissions: `shared/src/permissions.ts`. Supervisors are always site-scoped.
- RLS on all 28 `app` tables (83 policies). The API connects as `bc_api` and runs each request as `app_user`.

## 4. Data protection
- TLS everywhere (Vercel, DO + Caddy/LB, Supabase `sslmode=require` enforced in production config).
- Invitation tokens stored as SHA-256 hashes. No passwords stored by us.
- Location only at clock events (foreground). No background tracking (blocked in app config).
- CSV exports neutralize formula injection (`=`,`+`,`-`,`@`).
- Logs redact authorization headers, cookies, tokens, passwords.

## 5. Web security headers (vercel.json + helmet)
CSP (self + Supabase + API + Google Maps), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors none. `app.` and `admin.` hosts send `noindex`.

## 6. Secrets
- Server env only (`server/.env`, DO App/Droplet env). Never in web/mobile bundles (only `VITE_*`/`EXPO_PUBLIC_*` public values: Supabase URL + publishable key, API URL, restricted Maps key).
- The Supabase service-role/secret key is **not used** by any component.
- CI: gitleaks secret scan, CodeQL, Dependabot, `npm audit --audit-level=high`.

## 7. Verified by tests (server/tests/security.test.ts — 32 tests)
Cross-tenant reads/writes (API and raw SQL as `app_user`), role escalation, supervisor site scope, invitation email mismatch, revoked sessions (incl. refreshed tokens), tampered/expired/malformed tokens, Data API roles blocked, legacy quarantine, payroll below legal minimum (API + DB), append-only tables, SQL injection strings, error messages without internals, security headers, CORS, rate limits, admin without MFA / without recent auth.
Workflow suite (25) also covers: event-id hijack, duplicate events, offline bounds, paid payroll immutability, CSV formula injection.
Rate limits: tested (21st call to a 20/min public route → 429 `rate_limited`). Load tests disable them with `RATE_LIMITS_ENABLED=false`, which production config refuses.

## 8. Known gaps / to do before launch
1. Live Supabase dev project not yet inspected (connector has no access).
2. Penetration test by a third party — not done.
3. `npm audit` mobile: 3 moderate in Expo build tooling (`@expo/fingerprint` → `minimatch`). Not in the app bundle; wait for Expo patch.
4. GitHub settings to switch on (free): secret scanning + push protection, branch protection on `main` (PR + CI required), Dependabot alerts.
5. Supabase: enable leaked-password protection if plan allows; set password min length ≥ 10.
6. Report address `security@bluecollarshift.com` (in `/.well-known/security.txt`) must exist.

## Release A
- `SUPABASE_SERVICE_ROLE_KEY` is used **only by the API** (Render env) for Storage signed URLs. Never in `VITE_*` / `EXPO_PUBLIC_*`. Without it, file uploads are off (typed feedback still works).
- Uploads: private bucket, server-chosen paths (`company/kind/uuid.ext`), type and size limits on bucket and API, signed links short-lived.
- Turnstile site keys are public (`VITE_TURNSTILE_SITE_KEY`, `EXPO_PUBLIC_TURNSTILE_SITE_KEY`); the secret goes only into Supabase Auth settings.
- CSP allows `challenges.cloudflare.com` (script, frame); `Permissions-Policy: microphone=(self)`.
- Crew clock-in: only crew leads / attendance.crew, only people on the same shift today, each event records who entered it.
- Feedback table has no `app_user` access; only the API (system role after permission check).
