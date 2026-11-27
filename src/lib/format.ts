import { intlLocale } from '../i18n';

/** Formatting in the user's language. Times are shown in the company time zone; money in the company currency. */
const cache = new Map<string, Intl.DateTimeFormat>();
let currency = 'CAD';
export function setCurrency(c: string | null | undefined) {
  if (c) currency = c;
}
function f(opts: Intl.DateTimeFormatOptions, tz?: string) {
  const loc = intlLocale();
  const key = loc + JSON.stringify(opts) + (tz ?? '');
  let v = cache.get(key);
  if (!v) {
    v = new Intl.DateTimeFormat(loc, { ...opts, timeZone: tz });
    cache.set(key, v);
  }
  return v;
}

export const fmtDateTime = (iso: string | null | undefined, tz?: string) =>
  iso ? f({ dateStyle: 'medium', timeStyle: 'short' }, tz).format(new Date(iso)) : '—';
export const fmtDate = (iso: string | null | undefined, tz?: string) =>
  iso ? f({ dateStyle: 'medium' }, tz).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : '—';
export const fmtTime = (iso: string | null | undefined, tz?: string) => (iso ? f({ timeStyle: 'short' }, tz).format(new Date(iso)) : '—');
export const fmtWeekday = (iso: string, tz?: string) => f({ weekday: 'short', month: 'short', day: 'numeric' }, tz).format(new Date(iso));

export const fmtMinutes = (m: number | null | undefined) => {
  if (m === null || m === undefined) return '—';
  const h = Math.floor(m / 60);
  const mm = Math.abs(m % 60);
  return `${h}h ${String(mm).padStart(2, '0')}m`;
};
export const fmtHours = (m: number) => (m / 60).toFixed(2);
export const fmtMoney = (cents: number) => new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(cents / 100);
/** Money from a decimal string like "28.50". */
export const money = (amount: string | number) => fmtMoney(Math.round(Number(amount) * 100));

/** Value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => new Date(v).toISOString();

export function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(date = new Date(), weekStartDow = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekStartDow + 7) % 7));
  return d;
}
