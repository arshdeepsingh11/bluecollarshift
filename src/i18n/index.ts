import { en, type MessageKey } from './en';

/**
 * Minimal, dependency-free localisation. Components call t('key', { var }) — never hard-coded text.
 * To add French: create fr.ts with the same keys and add it to `dictionaries`.
 */
const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { en };
let current = 'en';

export function setLocale(locale: string) {
  const base = locale.split('-')[0] ?? 'en';
  current = dictionaries[base] ? base : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = dictionaries[current]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export type { MessageKey };
