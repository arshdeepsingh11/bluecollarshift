# Deployment

Order: database → API → web → mobile. Every step is done first on **development**, then repeated on production.

## 1. Database (Supabase)
Follow `supabase/README.md` (inspect → backup → migrate → verify → dashboard settings).
Set `bc_api` password (32+ random chars), store it only in the server env.

## 2. API (DigitalOcean)
1. Create Droplet: Ubuntu LTS, Docker, region `tor1`, SSH key only, firewall: 22 (your IP), 80, 443.
2. Build & run:
   ```bash
   git clone <repo> && cd <repo>
   docker build -f server/Dockerfile -t bluecollar-api .
   docker run -d --name api --restart unless-stopped --env-file /etc/bluecollar/api.env -p 127.0.0.1:8080:8080 bluecollar-api
   ```
3. TLS reverse proxy (Caddy): `api.bluecollarshift.com { reverse_proxy 127.0.0.1:8080 }` — Caddy gets certificates automatically.
4. `/etc/bluecollar/api.env` = `server/.env.example` filled in. Required in production:
   `NODE_ENV=production`, `DATABASE_URL` (pooler, port 6543, user `bc_api.<ref>`), `DATABASE_SSL=require`, `SUPABASE_URL`, `CORS_ORIGINS` (https only), `RESEND_API_KEY`, `EMAIL_FROM`. The API refuses to start if these are wrong.
5. First platform admin (one time, from your Mac — needs the direct `postgres` connection string, never stored on the server):
   `cd server && DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' node scripts/create-super-admin.mjs you@bluecollarshift.com`
   Sign up and verify the email first. Then enrol MFA at admin.bluecollarshift.com.
6. Check: `curl https://api.bluecollarshift.com/health/ready`.

## 3. Web (Vercel)
1. Import repo; root directory `/`; build `npm run build`; output `dist`.
2. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL=https://api.bluecollarshift.com`, `VITE_GOOGLE_MAPS_API_KEY` (restricted to the 3 domains).
3. Domains: `bluecollarshift.com`, `www.bluecollarshift.com` (redirect), `app.bluecollarshift.com`, `admin.bluecollarshift.com`. Host routing is in `vercel.json`.

## 4. DNS
`bluecollarshift.com`, `app`, `admin` → Vercel. `api` → Droplet IP (A record). Resend: add its SPF/DKIM records; add DMARC `v=DMARC1; p=quarantine; rua=mailto:dmarc@bluecollarshift.com`.

## 5. Mobile (EAS)
1. `cd mobile && npx eas init` (sets EAS project id) → set `EAS_PROJECT_ID`.
2. EAS env (production): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_MAPS_ANDROID_API_KEY`.
3. Push: upload APNs key (Apple) and FCM v1 credentials (Google) to EAS.
4. `npm run build:preview` (test builds) / `npm run build:production` → TestFlight / Play internal testing → device checklist (`docs/Testing.md` §6) → submit.
5. Store listings need: privacy policy URL (`https://bluecollarshift.com/privacy`), location purpose text (already in app config), data-safety form (location at clock events, email, name, work hours).

## 6. Release checklist
- [ ] CI green on `main` · [ ] migration applied on dev and verified · [ ] backup taken · [ ] env reviewed (no secrets in git) · [ ] `/health/ready` OK · [ ] smoke test: sign up, invite, clock in from phone, approve, payroll export.

## 7. Rollback
API: `docker run` previous image tag. Web: Vercel "Promote previous deployment". DB: `supabase/ROLLBACK.md` or restore backup. Mobile: cannot un-ship — use `min_mobile_version` / `maintenance_mode` platform settings.
