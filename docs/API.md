# API

Base URL: `https://api.bluecollarshift.com/api/v1` (local `http://localhost:8080/api/v1`). JSON only.
Contracts (request bodies): `shared/src/schemas.ts`. Response types: `shared/src/api-types.ts`.

## Auth
- Header `Authorization: Bearer <Supabase access token>` on every route except those marked **public**.
- Company routes: caller must be an active member of `:companyId` with the needed permission (`shared/src/permissions.ts`). RLS checks again in Postgres.
- `/admin/*`: platform staff, MFA (aal2). Critical actions also need sign-in within the last 10 minutes.

## Errors
```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid.", "details": [{ "path": "email", "message": "..." }] } }
```
| HTTP | code | Meaning |
|---|---|---|
| 400 | `validation_failed` / `bad_request` | Input invalid (details list the fields) |
| 401 | `unauthorized` | Token missing, expired, or session signed out/revoked |
| 403 | `forbidden` | Not allowed, MFA missing, or re-auth needed (message says which; logged as security event) |
| 404 | `not_found` | Not found **or** not visible to you (no existence leak) |
| 409 | `conflict` / `retry` | Duplicate or stale `expectedVersion` / concurrent write, retry |
| 429 | `rate_limited` | Too many requests |

## Rate limits
Global 300/min per IP+user. Stricter: register company 5/h, invitations 60/h, invitation preview 20/min, accept 10/min, attendance events 30/min, sync 60/min, messages 60/min.

## Offline sync
`POST /companies/:companyId/sync/events` — body `{ events: TimeEventInput[] }` (max 200).
Each event has a client UUID → retry-safe. Response per event: `accepted | duplicate | needs_review | rejected` + flags + session id.

## Realtime (Socket.IO)
Path `/realtime`, `auth: { token }`. Server events: `notification:new` (room `user:<id>`), `message:new` + `message:read` (`conv:<id>`), `attendance:update` + `shift:changed` + `timesheet:changed` (`company:<id>:staff`). Client emits `conversation:join` / `conversation:leave` (membership verified).

## Health
`GET /health` (process up) · `GET /health/ready` (DB reachable) — no `/api/v1` prefix.

## Endpoints (generated from `server/src/modules`, 77 routes)
| Module | Method | Path | Access |
|---|---|---|---|
| admin | GET | `/api/v1/admin/overview` | token |
| admin | GET | `/api/v1/admin/companies` | token |
| admin | GET | `/api/v1/admin/companies/:id` | token |
| admin | POST | `/api/v1/admin/companies/:id/status` | token |
| admin | GET | `/api/v1/admin/staff` | token |
| admin | POST | `/api/v1/admin/staff` | token |
| admin | PATCH | `/api/v1/admin/staff/:id` | token |
| admin | POST | `/api/v1/admin/users/:id/revoke-sessions` | token |
| admin | GET | `/api/v1/admin/audit` | token |
| admin | GET | `/api/v1/admin/security-events` | token |
| admin | POST | `/api/v1/admin/support-access` | token |
| admin | GET | `/api/v1/admin/support-access` | token |
| admin | GET | `/api/v1/admin/settings` | token |
| admin | PUT | `/api/v1/admin/settings/:key` | token |
| attendance | POST | `/api/v1/companies/:companyId/attendance/events` | token |
| attendance | POST | `/api/v1/companies/:companyId/sync/events` | token |
| attendance | GET | `/api/v1/companies/:companyId/attendance/me` | token |
| attendance | GET | `/api/v1/companies/:companyId/attendance/live` | token |
| companies | POST | `/api/v1/companies` | token |
| companies | GET | `/api/v1/companies/:companyId` | token |
| companies | PATCH | `/api/v1/companies/:companyId` | token |
| companies | GET | `/api/v1/companies/:companyId/payroll-settings` | token |
| companies | PUT | `/api/v1/companies/:companyId/payroll-settings` | token |
| companies | GET | `/api/v1/companies/:companyId/dashboard` | token |
| me | GET | `/api/v1/me` | token |
| me | PATCH | `/api/v1/me` | token |
| me | GET | `/api/v1/me/sessions` | token |
| me | POST | `/api/v1/me/sign-out-everywhere` | token |
| members | GET | `/api/v1/companies/:companyId/members` | token |
| members | GET | `/api/v1/companies/:companyId/members/:membershipId` | token |
| members | PATCH | `/api/v1/companies/:companyId/members/:membershipId` | token |
| members | GET | `/api/v1/companies/:companyId/members/:membershipId/pay-rates` | token |
| members | POST | `/api/v1/companies/:companyId/members/:membershipId/pay-rates` | token |
| members | GET | `/api/v1/companies/:companyId/invitations` | token |
| members | POST | `/api/v1/companies/:companyId/invitations` | token |
| members | POST | `/api/v1/companies/:companyId/invitations/:invitationId/revoke` | token |
| members | GET | `/api/v1/invitations/preview` | **public** |
| members | POST | `/api/v1/invitations/accept` | token |
| messaging | GET | `/api/v1/companies/:companyId/conversations` | token |
| messaging | GET | `/api/v1/companies/:companyId/contacts` | token |
| messaging | POST | `/api/v1/companies/:companyId/conversations` | token |
| messaging | GET | `/api/v1/companies/:companyId/conversations/:conversationId/messages` | token |
| messaging | POST | `/api/v1/companies/:companyId/conversations/:conversationId/messages` | token |
| messaging | POST | `/api/v1/companies/:companyId/conversations/:conversationId/read` | token |
| notifications | GET | `/api/v1/notifications` | token |
| notifications | POST | `/api/v1/notifications/:id/read` | token |
| notifications | POST | `/api/v1/notifications/read-all` | token |
| notifications | POST | `/api/v1/devices` | token |
| notifications | DELETE | `/api/v1/devices` | token |
| ops | GET | `/api/v1/ops/metrics` | token |
| ops | GET | `/api/v1/config` | **public** |
| payroll | GET | `/api/v1/companies/:companyId/pay-periods` | token |
| payroll | POST | `/api/v1/companies/:companyId/pay-periods` | token |
| payroll | POST | `/api/v1/companies/:companyId/pay-periods/:periodId/calculate` | token |
| payroll | POST | `/api/v1/companies/:companyId/pay-periods/:periodId/approve` | token |
| payroll | POST | `/api/v1/companies/:companyId/pay-periods/:periodId/mark-paid` | token |
| payroll | GET | `/api/v1/companies/:companyId/pay-periods/:periodId/records` | token |
| payroll | GET | `/api/v1/companies/:companyId/pay-periods/:periodId/export.csv` | token |
| payroll | GET | `/api/v1/companies/:companyId/my-pay` | token |
| reports | GET | `/api/v1/companies/:companyId/reports/hours` | token |
| reports | GET | `/api/v1/companies/:companyId/reports/attendance` | token |
| reports | GET | `/api/v1/companies/:companyId/reports/adjustments` | token |
| reports | GET | `/api/v1/companies/:companyId/audit` | token |
| shifts | GET | `/api/v1/companies/:companyId/shifts` | token |
| shifts | POST | `/api/v1/companies/:companyId/shifts` | token |
| shifts | PATCH | `/api/v1/companies/:companyId/shifts/:shiftId` | token |
| sites | GET | `/api/v1/companies/:companyId/sites` | token |
| sites | GET | `/api/v1/companies/:companyId/sites/:siteId` | token |
| sites | POST | `/api/v1/companies/:companyId/sites` | token |
| sites | PATCH | `/api/v1/companies/:companyId/sites/:siteId` | token |
| timesheets | GET | `/api/v1/companies/:companyId/timesheets` | token |
| timesheets | GET | `/api/v1/companies/:companyId/timesheets/:sessionId` | token |
| timesheets | POST | `/api/v1/companies/:companyId/timesheets/:sessionId/adjustments` | token |
| timesheets | POST | `/api/v1/companies/:companyId/timesheets/approve` | token |
| timesheets | GET | `/api/v1/companies/:companyId/disputes` | token |
| timesheets | POST | `/api/v1/companies/:companyId/timesheets/:sessionId/disputes` | token |
| timesheets | POST | `/api/v1/companies/:companyId/disputes/:disputeId/resolve` | token |
