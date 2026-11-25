# Supabase — how to apply (DEVELOPMENT project only)

Project: `zrrqixdqrsjbetltaqcd` (dev/test data only). Never run these on production first.

## Step 1 — Read-only inspection
Run in SQL Editor and save the output to `supabase/inspection/<date>.md`:
```sql
select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2;
select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies order by 1,2,3;
select n.nspname, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public') order by 2;
select event_object_table, trigger_name, action_timing, event_manipulation from information_schema.triggers order by 1;
select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 2;
select relname, n_live_tup from pg_stat_user_tables order by 2 desc;
```
Compare with `supabase/schema.sql`. If the live DB differs, stop and update the plan.

## Step 2 — Backup
- Dashboard → Database → Backups (Free plan has no PITR) **and** a manual dump:
```bash
supabase db dump --db-url "$DEV_DB_URL" -f backup/schema-$(date +%F).sql
supabase db dump --db-url "$DEV_DB_URL" --data-only -f backup/data-$(date +%F).sql
```
Keep the files outside git.

## Step 3 — Apply migrations
```bash
for f in supabase/migrations/*.sql; do psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break; done
psql "$DEV_DB_URL" -c "alter role bc_api with password '<generate 32+ random chars>'"
```
(or `supabase db push` with the CLI linked to the dev project).

## Step 4 — Verify
```sql
select count(*) from pg_policies where schemaname = 'app';   -- expect 83
select has_schema_privilege('anon','app','usage');            -- expect false
select count(*) from legacy.employers;                        -- legacy data kept
```
Then point `server/.env` `DATABASE_URL` at the pooler with user `bc_api.<project-ref>` and run the API.

## Step 5 — Supabase dashboard settings
Auth → Email: confirm email ON, secure password change ON, min password length 10+.
Auth → SMTP: Resend (smtp.resend.com, port 465, user `resend`, password = Resend API key).
Auth → MFA: TOTP ON. Auth → URL config: Site URL `https://app.bluecollarshift.com`; redirects `https://app.bluecollarshift.com/**`, `https://admin.bluecollarshift.com/**`, `http://localhost:5173/**`, `http://localhost:4173/**`, `bluecollar://**`.
API → Exposed schemas: keep `public` only (do **not** add `app` or `legacy`).

Rollback: `supabase/ROLLBACK.md`.
