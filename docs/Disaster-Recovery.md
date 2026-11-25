# Disaster recovery

## 1. Targets (launch)
- **RPO** (max data loss): 24 h on Supabase Pro daily backups; near-zero for clock events still on phones (they re-sync).
- **RTO** (time to restore): 4 h.
- Upgrade path: Supabase PITR add-on when paying customers need RPO < 24 h (needs approval — paid).

## 2. Backups
| What | How | Keep |
|---|---|---|
| Database | Supabase daily backups (Pro, 7 days) + weekly `supabase db dump` to encrypted storage you own | 7 d / 12 weeks |
| Code | GitHub + release ZIPs | forever |
| Server env | Password manager (never git) | — |
| Mobile signing keys | EAS managed credentials + offline copy in password manager | forever |

**Test a restore every 3 months** into a scratch project; record date and time taken here.

## 3. Scenarios
| Event | Action |
|---|---|
| API droplet dead | New droplet → `docker build/run` (Deployment §2) → move DNS/Reserved IP. Phones keep queuing meanwhile. |
| Bad deploy | Run previous image tag; Vercel promote previous. |
| Bad migration | Stop API → `supabase/ROLLBACK.md` or restore backup → redeploy previous API. |
| Data deleted by mistake | Restore backup to a new project, copy rows back (never overwrite live blindly). |
| Leaked secret | Rotate: `bc_api` password, Resend key, Maps key, Supabase JWT keys (forces sign-in), webhook URL. Revoke sessions (admin). Review audit/security events. |
| Account takeover of admin | Revoke sessions, reset password + MFA, review audit log, notify affected companies if data accessed. |
| Supabase region outage | Wait / status page; phones keep working offline. Restore from dump in another region if > RTO. |

## 4. Incident steps
1. Contain (revoke, maintenance_mode). 2. Preserve logs. 3. Fix. 4. Notify (PIPEDA/Alberta PIPA breach rules — "real risk of significant harm" → notify regulator and people; legal review). 5. Write a postmortem in `docs/incidents/`.
