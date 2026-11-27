# ADR 0008 — Company-set pay policy and Release A
**Date:** 2026-11-27 · **Status:** Accepted · **Supersedes:** ADR 0007

**Context:** Blue Collar grows beyond Alberta into Canada, the US and Mexico. Laws differ by province/state. The owner decided the app should not teach or enforce overtime law.

**Decision:**
1. `rule_profile = COMPANY_POLICY`. Daily and weekly overtime can each be turned on/off; thresholds and rate are free within sanity bounds (daily 1–24 h, weekly 1–168 h, rate 1–5×). The DB CHECK for Alberta minimums is dropped.
2. Every company has `country` (CA/US/MX) and `currency` (CAD/USD/MXN); time zone chosen per company.
3. Six languages (en, es-MX, fr-CA, pa, hi, gu) for web, mobile, notifications and emails. A test fails if any key or `{placeholder}` is missing.
4. New modules: crew clock-in, shift swaps/open shifts, time off and availability, payroll export formats, no-show and overtime alerts, safety reports and toolbox talks, feedback (typed or voice, no paid speech-to-text).
5. Files (voice, photos) go to a private Supabase Storage bucket; only the API holds the service key and hands out short-lived signed URLs.
6. Cloudflare Turnstile (free) via Supabase Auth `captchaToken`; off until site keys are set.

**Consequences:** Companies are responsible for setting a legal policy. Existing companies keep their current numbers. Rollback: `supabase/ROLLBACK.md` (0500).
