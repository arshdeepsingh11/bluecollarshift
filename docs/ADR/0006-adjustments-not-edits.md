# ADR 0006 — Adjustments instead of edits; immutable paid payroll
Status: accepted
**Decision:** `time_events`, `adjustments`, `audit_logs` are append-only (DB triggers). Effective values via view `work_sessions_effective`. Paid payroll cannot change.
**Why:** Wage disputes need an untouched original record and a clear who/why trail.
