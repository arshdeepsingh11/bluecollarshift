# Items for legal / payroll professional review

Nothing here is legal advice. These are assumptions built into the software that a qualified person must confirm before launch.

## Alberta Employment Standards (payroll engine `shared/src/payroll/`)
1. Overtime = greater of daily (> 8 h/day) and weekly (> 44 h/week), not both (no double counting).
2. Overtime rate default 1.5×; settings may be higher, never lower.
3. Averaging agreements (1–12 week periods): overtime = hours over 44 × weeks in the period; blocks counted in the pay period in which they end.
4. Breaks: 30 min per 5 h worked (unpaid unless company chooses paid). The app records breaks; it does not force them.
5. Work week start day is configurable (default Sunday).
6. Overtime banking agreements: flag exists (`overtimeAgreementBanking`); time-bank balances are **not** calculated in v1.
7. Exemptions (e.g. some construction/oil & gas rules, managers) are **not** modelled. Owner must not use the app's overtime for exempt roles without review.
8. Statutory holiday pay, vacation pay (4%/6%), minimum wage checks, deductions (CPP, EI, income tax) are **not** calculated. Exports say "gross estimate".

## Privacy (PIPEDA / Alberta PIPA)
9. Location collected only at clock events; purpose stated in app and privacy page. Employer must inform employees (template text needed).
10. Retention periods (attendance, messages, audit logs) — to define. Payroll records: at least 3 years (Alberta ES Code) — confirm.
11. Breach notification process (`docs/Disaster-Recovery.md` §4).
12. Hosting region and sub-processors list (Supabase, DigitalOcean, Vercel, Resend, Expo, Google) for the privacy page.

## Website legal pages (`src/pages/public/Pages.tsx`)
13. Privacy Policy, Terms of Service, Security page are **drafts** marked for lawyer review.
14. Pricing/subscription terms — not yet written (subscription planned later).
