# ADR 0001 — Keep the web app at the repo root
Status: accepted (2026-11-25)
**Context:** Existing React app lives at root; ZIP overlay workflow needs stable paths.
**Decision:** Add `server/`, `mobile/`, `shared/`, `docs/` beside it. No monorepo `apps/` move.
**Consequences:** Simple merges. Each folder has its own `package.json`; `shared/` is imported by path alias, not a workspace package.
