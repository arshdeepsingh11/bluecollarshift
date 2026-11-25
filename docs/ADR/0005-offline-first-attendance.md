# ADR 0005 — Offline-first attendance
Status: accepted
**Decision:** Phone writes every clock event to SQLite first with a UUID; sync engine sends batches; server is idempotent and trusts device time only for offline events within −14 d / +2 min, flagging them.
**Why:** Job sites often have no signal; events must never be lost or duplicated.
**Consequences:** Some events land in `needs_review`; managers resolve via adjustments.
