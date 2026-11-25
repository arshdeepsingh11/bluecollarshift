# Monitoring (free / built-in first)

## 1. What exists in the code
| Signal | Where |
|---|---|
| Liveness / readiness | `GET /health`, `GET /health/ready` (DB ping) |
| API metrics (requests, errors, latency p50/p95/p99 per route, DB latency, pool, jobs) | `GET /api/v1/ops/metrics` (platform staff) |
| Structured JSON logs (pino), secrets redacted | Docker logs |
| Job history (last run, duration, errors) | `app.job_runs` |
| Security events (403s, failed admin checks, revoked sessions) | `app.security_events`, admin.bluecollarshift.com → Security |
| Audit trail | `app.audit_logs`, admin → Audit log |
| Critical admin actions alert | `ALERT_WEBHOOK_URL` (Slack/Discord webhook) |

## 2. To set up (free)
1. Uptime check on `https://api.bluecollarshift.com/health/ready` and `https://bluecollarshift.com` every 5 min (e.g. UptimeRobot free, or DigitalOcean uptime check).
2. DigitalOcean monitoring agent: alerts CPU > 70% 10 min, memory > 80%, disk > 80%.
3. Supabase: Reports → database CPU/disk; Advisors (security + performance) weekly.
4. Google Maps: budget alert + daily quota.
5. Resend: bounce/complaint webhook (later) — watch dashboard weekly.

## 3. Alert thresholds
| Metric | Warn | Act |
|---|---|---|
| API p99 | > 200 ms | > 500 ms |
| 5xx rate | > 0.5% | > 2% |
| `/health/ready` down | 1 check | 2 checks |
| Sync `needs_review` share | > 5% | > 15% (check geofence/GPS) |
| Job failures | 1 | 3 in a row |

## 4. Weekly review
Security events, admin audit, failed jobs, `npm audit`/Dependabot PRs, Supabase advisors.
