# Testing — actual results

Environment: Linux sandbox, 2 vCPU, Node 22, Postgres 16 (local). Date: 2026-11-25.
"Passed" below means it ran and passed here. Anything not run is listed under **Not verified**.

## 1. Automated tests
| Suite | Command | Result |
|---|---|---|
| Shared (payroll engine, permissions, sync rules) | `cd shared && npm test` | **34 / 34 passed** |
| Server security | `cd server && npm test` | **32 / 32 passed** |
| Server workflows (sign-up → invite → shift → clock → adjust → dispute → payroll → messages) | same | **25 / 25 passed** |
| Server realtime (Socket.IO auth, rooms, expiry) | same | **4 / 4 passed** |
| Mobile offline sync engine + version check | `cd mobile && npm test` | **13 / 13 passed** |
| **Total** | | **108 / 108** |

Re-run after upgrading zod 3 → 4.6.7 and react-router 7.18.7: all suites passed again. Re-run after upgrading test/build tools (vitest 5.1.2, esbuild 0.28.2, vite patch): all passed. Re-run again on a clean copy of the original main folder + this release ZIP (`npm ci` everywhere): all passed.

## 2. Static checks
| Check | Result |
|---|---|
| TypeScript: web (`tsc -b`), server, shared, mobile | 0 errors |
| Lint (oxlint) | 0 errors (fast-refresh warnings only) |
| Web production build + prerender (7 public pages) | OK |
| Mobile bundle `expo export` iOS + Android | OK (Hermes bytecode 4.4 MB each) |
| `npm audit` (all packages, incl. build/test tools) | web, shared, server: 0. Mobile: 3 moderate in Expo build tooling (no fix without downgrading Expo) |
| Server production bundle boots, `/health/ready` OK | OK |
| Migration rollback (`supabase/ROLLBACK.md`) on scratch DB | OK |
| CI database | GitHub uses Postgres 17 (Supabase's current version); local tests here used 16 |

## 3. Performance (seed: 400 companies, 10,400 people, 403,200 work sessions, 806,400 events)
| Endpoint | p50 | p99 | 10-concurrent rps | errors |
|---|---|---|---|---|
| GET /me | 0 ms | 0 ms | 11,188 | 0 |
| GET dashboard (manager) | 5 ms | 12 ms | 366 | 0 |
| GET timesheets 1 week | 9 ms | 20 ms | 171 | 0 |
| GET attendance/me | 2 ms | 6 ms | 641 | 0 |
| POST sync/events | 3.4 ms | 8.4 ms | 459 | 0 |
Raw: `server/tests/perf/results-2026-11-25.json`. Query plans: `docs/Database.md` §5.

## 4. Manual / E2E
Web app built against the real API with test data: 12 screens (public, employer, employee, admin) loaded with no console errors.

## 5. Not verified (needs real devices / accounts)
- Mobile app on physical iPhone/Android (GPS, push, background task, SQLite on device, airplane-mode test).
- Live Supabase project (Auth emails, MFA enrolment, JWKS keys) — connector blocked.
- Resend real email delivery, Expo push delivery, Google Maps keys.
- Docker image build (no Docker daemon here; steps simulated). CI runs it on GitHub.
- Load beyond one 2-vCPU machine; network latency to Supabase region.

## 6. Device test checklist (do before store release)
1. Clock in online → appears on manager live board within seconds.
2. Airplane mode → clock in, break, clock out → "waiting to sync" → turn network on → all synced, times = device times, flagged "offline".
3. Kill app while offline → reopen → events still there.
4. Deny location → event saved with `no_location` flag.
5. Stand outside geofence → `outside_geofence` flag on manager side.
6. Sign out with unsynced events → sign in → events sync.
7. Push: shift assigned → notification arrives; tap opens app.
8. Message offline → "Queued" → online → delivered once.
