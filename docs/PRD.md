# Blue Collar — Product Requirements

## 1. What it is
Workforce app for trade companies (construction, electrical, plumbing, HVAC). Launch market: Alberta.
Employers schedule crews, see live attendance, approve timesheets and prepare payroll.
Employees clock in/out from their phone — **also without signal** — see shifts, hours, pay and messages.

## 2. Surfaces
| Surface | URL | Users |
|---|---|---|
| Public website | bluecollarshift.com | Visitors (SEO, pricing, sign-up) |
| Employer web app | app.bluecollarshift.com | Owner, admin, manager, supervisor, payroll |
| Platform admin | admin.bluecollarshift.com | Blue Collar staff (MFA required) |
| Employee mobile app | iOS + Android | Employees |
| API | api.bluecollarshift.com | All of the above |

## 3. Roles
- **Company:** owner, admin, manager, supervisor (site-scoped), payroll, employee.
- **Platform:** super_admin, platform_admin, support, operations, billing, auditor.
- Permissions: `shared/src/permissions.ts` (single source for API, web and mobile).

## 4. Features (v1)
1. Company sign-up, invitations by email (hashed tokens, expiry, email must match).
2. Job sites with address, map pin and geofence radius.
3. Shifts: create, repeat weekly, assign, conflict warnings, instructions, version check, notifications.
4. Attendance: clock in/out, breaks, GPS at event time only, geofence flags, offline queue, duplicates blocked.
5. Live attendance board (who is in, late, on break, outside site).
6. Timesheets: original vs adjusted, adjustment reason + author, approval, employee disputes.
7. Payroll prep: Alberta rules (8/44 greater-of, averaging, breaks, configurable week), periods, calculate → approve → mark paid, CSV export, calculation trace.
8. Messaging: direct + group, text only, read receipts, offline outbox, realtime.
9. Notifications: in-app, push (Expo), email (Resend); deduplicated.
10. Reports: hours, attendance, adjustments (CSV); company audit log.
11. Platform admin: companies, suspend/restore, staff, audit, security events, time-boxed support access, settings.
12. Security: email recovery, MFA for admins, sign-out everywhere, session revocation.

## 5. Out of scope (v1)
Tax/CPP/EI deductions, direct deposit, paid SMS/chat services, message attachments (schema ready), other provinces (profile system ready), billing/subscriptions (planned at 5,000 employers).

## 6. Success criteria
- Clock event saved on phone in < 1 s, synced automatically when online, never lost.
- API p99 < 50 ms for main reads at ~10k employees (measured: see Testing.md).
- Zero cross-company data access (security test suite).

## 7. Assumptions needing confirmation
- Legal pages and Alberta rules need review by a lawyer/payroll professional (`docs/Legal-Review.md`).
- Hosting region (Supabase/DigitalOcean in Canada) to confirm before launch.
