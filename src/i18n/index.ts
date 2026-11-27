import { en, type MessageKey } from './en';

/**
 * Localisation: English is built in; other languages load on demand (one small file each).
 * Components call t('key', { var }) — never hard-coded text.
 * The chosen language is saved on the device and on the user's profile (so emails, push
 * notifications and the phone app use it too).
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es-MX', name: 'Español (México)' },
  { code: 'fr-CA', name: 'Français (Canada)' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'gu', name: 'ગુજરાતી' },
] as const;
export type LocaleCode = (typeof LANGUAGES)[number]['code'];

type Dict = Partial<Record<MessageKey, string>>;
const loaders: Record<Exclude<LocaleCode, 'en'>, () => Promise<{ default: Dict }>> = {
  'es-MX': () => import('./es-MX'),
  'fr-CA': () => import('./fr-CA'),
  pa: () => import('./pa'),
  hi: () => import('./hi'),
  gu: () => import('./gu'),
};
const loaded: Partial<Record<LocaleCode, Dict>> = { en };
let current: LocaleCode = 'en';
const listeners = new Set<(l: LocaleCode) => void>();
const STORAGE_KEY = 'bc.locale';

export function normalizeLocale(l: string | null | undefined): LocaleCode {
  if (!l) return 'en';
  const exact = LANGUAGES.find((x) => x.code.toLowerCase() === l.toLowerCase());
  if (exact) return exact.code;
  const base = l.split('-')[0]?.toLowerCase();
  if (base === 'es') return 'es-MX';
  if (base === 'fr') return 'fr-CA';
  return LANGUAGES.find((x) => x.code === base)?.code ?? 'en';
}

export function storedLocale(): LocaleCode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? normalizeLocale(v) : null;
  } catch {
    return null;
  }
}

/** The device's language if we support it (first visit), otherwise English. */
export function initialLocale(): LocaleCode {
  const stored = storedLocale();
  if (stored) return stored;
  if (typeof navigator === 'undefined') return 'en';
  for (const l of navigator.languages ?? [navigator.language]) {
    const n = normalizeLocale(l);
    if (n !== 'en' || l.toLowerCase().startsWith('en')) return n;
  }
  return 'en';
}

export function getLocale(): LocaleCode {
  return current;
}

export async function setLocale(locale: string, persist = false): Promise<void> {
  const code = normalizeLocale(locale);
  if (code !== 'en' && !loaded[code]) {
    try {
      loaded[code] = (await loaders[code]()).default;
    } catch {
      return; // offline: keep the current language
    }
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* private mode */
    }
  }
  if (code === current) return;
  current = code;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
    document.documentElement.dataset.script = code === 'pa' ? 'gurmukhi' : code === 'hi' ? 'devanagari' : code === 'gu' ? 'gujarati' : 'latin';
  }
  listeners.forEach((fn) => fn(code));
}

export function onLocaleChange(fn: (l: LocaleCode) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = loaded[current]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Intl locale for numbers and dates (Gurmukhi for Punjabi). */
export function intlLocale(): string {
  return current === 'pa' ? 'pa-Guru-IN' : current === 'hi' ? 'hi-IN' : current === 'gu' ? 'gu-IN' : current === 'en' ? 'en-CA' : current;
}

export type { MessageKey };
