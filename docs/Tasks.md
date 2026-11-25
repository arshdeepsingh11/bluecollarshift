# Tasks

## Done (v1 build, 2026-11-25)
- [x] Shared package: permissions, contracts (zod 4), Alberta payroll engine, sync rules
- [x] Database: legacy quarantine, `app` schema, triggers, RLS (83 policies), performance fix
- [x] API: 77 routes, realtime, jobs, email, push, audit, security events
- [x] Web: public site (SEO, prerender), employer app, platform admin, MFA, brand
- [x] Mobile: login, Today/clock (offline), schedule, hours + dispute, messages (offline outbox), pay, notifications, sync screen, min-version/maintenance
- [x] Tests 108 (shared 34, server 61, mobile 13), perf + load measurements
- [x] Docs, ADRs, CI (tests, build, audit, gitleaks, CodeQL, Docker), Dependabot

## Blocked — owner action needed
- [ ] **Supabase connector access** to project `zrrqixdqrsjbetltaqcd` (reconnect with the owning account) → then inspect/backup/migrate dev DB (`supabase/README.md`)
- [ ] Approve costs: Supabase Pro, DO droplet, Vercel Pro (or Cloudflare Pages), Apple $99/yr, Google $25
- [ ] Create accounts/keys: Resend (domain DNS), Google Maps (restricted keys), Expo/EAS, Apple, Google Play, APNs key, FCM
- [ ] Lawyer/payroll review: `docs/Legal-Review.md`
- [ ] Confirm hosting region (Canada) for privacy page

## Next (before store release)
- [ ] Device testing checklist (`docs/Testing.md` §6) on iPhone + Android
- [ ] GitHub: branch protection, secret scanning + push protection
- [ ] Uptime checks + DO alerts (`docs/Monitoring.md`)
- [ ] Production Supabase project (separate), production env, first super admin
- [ ] Store listings: screenshots, privacy/data-safety forms

## Later
- [ ] Subscriptions/billing (at ~5,000 employers)
- [ ] Message attachments (schema ready)
- [ ] More provinces (rules profile ready)
- [ ] French translation
- [ ] PITR backups when customers require it
