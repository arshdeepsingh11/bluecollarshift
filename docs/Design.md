# Design

## Brand
- Name: **Blue Collar**. Logo: the owner's circular "Blue Collar" logo, traced to vector (`brand/logo.svg`, source `brand/original-logo.png`, script `brand/trace-logo.py`).
- Brand blue `#016B93` (sampled from the logo). Navy `#0B2A3A`. White surfaces.
- Icons generated from the logo: favicon (svg/32/48), apple-touch, 192/512, maskable, Android adaptive, notification (white silhouette), splash, OG image — all in `brand/`, copies in `public/` and `mobile/assets/`.

## Tokens (web `src/index.css`, mobile `mobile/src/lib/config.ts`)
| Token | Value | Use |
|---|---|---|
| primary / hover / dark | #016B93 / #015A7C / #014A66 | Buttons, links, active nav |
| light | #E6F2F7 | Info backgrounds, selected rows |
| bg / surface / surface-2 | #F5F8FA / #FFF / #F0F4F7 | Page, cards, inputs |
| border | #DBE3EA | Dividers |
| text / 2 / 3 | #14212B / #45566A / #6B7B8D | Body, secondary, hints |
| success / warning / error | #1F7A4D / #8A5A00 / #B42318 (+ light bg) | Status badges and banners |
| radius | 8 / 12 / 18 px | Inputs / cards / big tiles |
Contrast: white on primary 5.9:1, text on white 15.6:1 (WCAG AA).

## Principles
1. **Job-site first (mobile):** one big Clock in / Clock out button (76 px tall), high contrast, works with gloves, works offline, clear sync status.
2. **Honest states:** "Saved on this phone", "Waiting to sync", "Needs manager review", "Could not be recorded" — never pretend something is synced.
3. **Original vs adjusted** always shown side by side with reason and who changed it.
4. **Calm dashboards:** counts first (working, late, on break, outside site), details on tap.
5. Accessibility: labels on all inputs, `accessibilityRole` on buttons, focus ring on web, live region for clock status, minimum 48 px targets.

## Copy
All text through translation keys (`src/i18n/en.ts`, `mobile/src/i18n.ts`). Plain English, short sentences, no jargon. Legal-sounding pay text always says "gross estimate".
