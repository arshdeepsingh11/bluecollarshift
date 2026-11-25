# Infrastructure & costs

Prices checked 2026-11-25 (USD). Confirm on each pricing page before buying. **Nothing is bought without owner approval.**

## 1. Components
| Part | Service | Plan to start | Monthly |
|---|---|---|---|
| Auth + Postgres | Supabase | Free for dev; **Pro** for production (Free pauses after 7 idle days, no backups) | $0 → $25 (includes $10 compute credit) |
| API | DigitalOcean Droplet (Toronto, Docker) | Basic 2 GB / 1 vCPU | ~$12 (+20% for weekly backups) |
| Web (3 hosts) | Vercel | Hobby is **non-commercial only** → **Pro** for a paid SaaS | $20 per member |
| Email | Resend | Free: 3,000/month, 100/day, 1 domain | $0 → $20 (50k/month) |
| Push | Expo Push → APNs/FCM | Free | $0 |
| Maps | Google Maps Platform | Restricted keys, quotas, budget alert | $0 within free monthly usage |
| Builds | EAS (Expo) | Free tier (limited builds) or build locally on the Mac | $0 |
| App stores | Apple Developer / Google Play | — | $99/year · $25 one-time |
| Domain | bluecollarshift.com | Already owned | — |

**Estimated launch cost:** about $57/month (Supabase Pro 25 + Droplet 12 + Vercel Pro 20) + $99/yr Apple + $25 Google.
Cheaper web option (needs approval): host the static web on Cloudflare Pages (free plan allows commercial use) → ~$37/month.

## 2. Sizing (from measurements, see Testing.md)
- One 2 vCPU API instance served 170–11,000 req/s with p99 < 100 ms at ~10k employees.
- 5,000 employers × ~4 employees ≈ 20,000 employees: expected to fit one 2 GB droplet + Supabase Micro/Small. Upgrade only when monitoring shows CPU > 70% or p99 > 200 ms.
- Not needed now: Redis, queues, Kubernetes, microservices, separate DigitalOcean Postgres.

## 3. Regions
Canada preferred (Supabase `ca-central-1`, DO `tor1`). **Confirm before creating the production project** — the privacy page says "Canada (to confirm)".

## 4. Limits to watch
Supabase Pro: 8 GB DB, 250 GB egress, 100k MAU included. Resend Free: 100 emails/day (invites + reminders can exceed this → Pro).

Sources: supabase.com/pricing, digitalocean.com/pricing/droplets, vercel.com/pricing, resend.com/pricing.
