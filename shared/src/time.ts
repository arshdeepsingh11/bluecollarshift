/** Time and location helpers. No external dependencies (Intl only). */

export const MINUTE_MS = 60_000;

export function minutesBetween(startIso: string | Date, endIso: string | Date): number {
  const s = typeof startIso === 'string' ? Date.parse(startIso) : startIso.getTime();
  const e = typeof endIso === 'string' ? Date.parse(endIso) : endIso.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new Error('Invalid date');
  return Math.max(0, Math.round((e - s) / MINUTE_MS));
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = dateFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    dateFmtCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: string | Date, timeZone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = fmt(timeZone).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Day of week (0 = Sunday) of an instant in a time zone. */
export function localWeekday(instant: string | Date, timeZone: string): number {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const wd = fmt(timeZone).formatToParts(d).find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return WEEKDAYS[wd] ?? 0;
}

/** Add days to a YYYY-MM-DD date string (calendar arithmetic, time-zone free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD calendar date. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Start (YYYY-MM-DD) of the work week containing `date`, given the week's first weekday. */
export function workWeekStart(date: string, weekStartDow: number): string {
  const diff = (weekdayOfDate(date) - weekStartDow + 7) % 7;
  return addDays(date, -diff);
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Money helpers — all money is handled as integer cents to avoid float errors. */
export function toCents(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error('Invalid amount');
  return Math.round(n * 100);
}

export function centsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Pay for `minutes` at `rateCents` per hour times `multiplier`, rounded half-up to the cent. */
export function payForMinutes(minutes: number, rateCents: number, multiplier = 1): number {
  return Math.round((minutes * rateCents * multiplier) / 60);
}
