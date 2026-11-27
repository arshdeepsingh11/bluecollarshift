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

## Release A routes (2026-11-27)
All under `/api/v1/companies/:companyId`, token required. Bodies: `shared/src/schemas.ts`.
| Module | Method | Path | Permission |
|---|---|---|---|
| crew | GET | `/crew` | attendance.crew or crew lead |
| crew | POST | `/crew/events` | same; ≤ 50 people per call; each event stores `recorded_by_membership_id` |
| requests | GET | `/open-shifts` | employee |
| requests | GET | `/coworkers` | employee (names only) |
| requests | GET/POST | `/shift-requests` | employee (own) / requests.manage (all) |
| requests | POST | `/shift-requests/:id/respond` | the asked coworker |
| requests | POST | `/shift-requests/:id/decide` | requests.manage |
| requests | POST | `/shift-requests/:id/cancel` | requester |
| requests | GET/POST | `/time-off` | employee (own) / requests.manage (all) |
| requests | POST | `/time-off/:id/decide`, `/time-off/:id/cancel` | requests.manage / requester |
| requests | GET/PUT | `/availability/me` | employee |
| requests | GET | `/members/:memberId/availability` | requests.manage |
| safety | GET/POST | `/safety/reports` | any member (own) / safety.manage (all) |
| safety | POST | `/safety/reports/:id/close` | safety.manage |
| safety | GET/POST | `/safety/talks` | safety.manage or crew lead (create) |
| safety | POST | `/safety/talks/:id/sign` | attendee |
| payroll | GET | `/pay-periods/:id/export.csv?format=generic\|adp\|gusto\|quickbooks\|wagepoint` | payroll.export |

Not company-scoped:
| Module | Method | Path | Auth |
|---|---|---|---|
| feedback | POST | `/feedback` | token; returns signed upload URLs for voice/screenshot (503 if storage not set and only voice sent) |
| feedback | GET | `/feedback/mine` | token |
| feedback | GET | `/admin/feedback`, `/admin/feedback/:id/files` | platform.feedback.view |
| feedback | PATCH | `/admin/feedback/:id` | platform.feedback.manage |

Uploads: the API returns a signed upload URL (valid 2 h, one file, max 5 MB, audio or image). Files are read only through signed download URLs (10 min).
