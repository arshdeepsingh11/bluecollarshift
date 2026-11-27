# Items for legal / payroll professional review

Nothing here is legal advice. These are assumptions built into the software that a qualified person must confirm before launch.

## Pay policy (payroll engine `shared/src/payroll/`)
Since Release A the company sets its own overtime policy; the app shows "adjust as per your company policy" and gives no legal advice. Confirm with a lawyer that this wording plus the disclaimer is enough in CA, US and MX.
Older notes below (Alberta) are kept for history only.

### (History) Alberta Employment Standards
1. Overtime = greater of daily (> 8 h/day) and weekly (> 44 h/week), not both (no double counting).
2. Overtime rate default 1.5×; settings may be higher, never lower.
3. Averaging agreements (1–12 week periods): overtime = hours over 44 × weeks in the period; blocks counted in the pay period in which they end.
4. Breaks: 30 min per 5 h worked (unpaid unless company chooses paid). The app records breaks; it does not force them.
5. Work week start day is configurable (default Sunday).
6. Overtime banking agreements: flag exists (`overtimeAgreementBanking`); time-bank balances are **not** calculated in v1.
7. Exemptions (e.g. some construction/oil & gas rules, managers) are **not** modelled. Owner must not use the app's overtime for exempt roles without review.
8. Statutory holiday pay, vacation pay (4%/6%), minimum wage checks, deductions (CPP, EI, income tax) are **not** calculated. Exports say "gross estimate".

## Privacy (PIPEDA, provincial laws, US state laws, Mexico LFPDPPP)
9. Location collected only at clock events; purpose stated in app and privacy page. Employer must inform employees (template text needed).
10. Retention periods (attendance, messages, audit logs) — to define. Payroll records: at least 3 years (Alberta ES Code) — confirm.
11. Breach notification process (`docs/Disaster-Recovery.md` §4).
12. Hosting region and sub-processors list (Supabase, DigitalOcean, Vercel, Resend, Expo, Google) for the privacy page.

## Website legal pages (`src/pages/public/Pages.tsx`)
13. Privacy Policy, Terms of Service, Security page are **drafts** marked for lawyer review.
14. Pricing/subscription terms — not yet written (subscription planned later).

## Release A — items for review
- Voice notes and screenshots in feedback, safety photos: stored in a private Supabase Storage bucket, signed links only (10 min). Add to the privacy policy (done in Pages.tsx) and set a retention period.
- Microphone and camera permissions: asked only when the user taps record / photo.
- Cloudflare Turnstile on login and sign-up: a third-party processor; listed in the privacy page.
- Crew clock-in: a crew lead records time for others. Each event stores who recorded it (`recorded_by_membership_id`). Confirm employees are told about this.
- Safety reports are records, not official incident reports to any government body. Companies keep their own legal reporting duties.
- Payroll export files (ADP, Gusto, QuickBooks, Wagepoint): formats based on public import templates. Each customer must test one import before relying on it.
