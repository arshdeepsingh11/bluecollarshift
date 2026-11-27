# Blue Collar

Workforce app for trade companies — scheduling, offline clock-in, timesheets, payroll prep (each company sets its own overtime policy), 6 languages, messaging.

| Folder | What | Start |
|---|---|---|
| `/` | Web: public site, employer app, platform admin | `npm ci && npm run dev` → http://localhost:5173 (`/app`, `/admin`) |
| `server/` | API (Fastify + Socket.IO) | `cd server && npm ci && npm run dev` → :8080 |
| `mobile/` | Employee app (Expo) | `cd mobile && npm ci && npx expo start` |
| `shared/` | Shared rules, schemas, payroll engine | `cd shared && npm ci && npm test` |
| `supabase/` | Migrations, rollback, apply guide | `supabase/README.md` |
| `docs/` | PRD, Architecture, Security, API, Testing, Deployment… | start with `docs/Rules.md` |

## First-time setup (Windows or Mac)
1. Node 22 and Postgres 16+ (Windows: installers from nodejs.org and postgresql.org; Mac: `brew install node@22 postgresql@17`).
2. `npm ci` in `/`, `shared/`, `server/`, `mobile/`.
3. Copy each `.env.example` → `.env` and fill in (never commit `.env`).
4. Database: `supabase/README.md` (dev project only).
5. Tests: `cd server && npm test` (needs local Postgres on port 54329, user `postgres`, trust auth — or set `TEST_PG_HOST`/`TEST_PG_PORT`).

## Rules
Read `docs/Rules.md` first. Short version: no trust by default, no single point of security failure, everything verified.
