# ADR 0004 — RLS as a second authorization layer
Status: accepted
**Decision:** API checks permissions; every query also runs as `app_user` with RLS; trusted jobs use `app_system` with explicit policies; composite FKs block cross-tenant links.
**Why:** Rule 2 — no single point of security failure.
**Cost:** Policy helpers must be set-based (`any((select f())::uuid[])`) — measured 225 → 6.6 ms.
