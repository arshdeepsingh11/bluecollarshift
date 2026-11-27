import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined }));
const { ALL_DICTS } = await import('../src/i18n');

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('phone app translations', () => {
  const en = ALL_DICTS.en;
  for (const [code, dict] of Object.entries(ALL_DICTS)) {
    it(`${code}: every text exists, is not empty, and keeps the same {placeholders}`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(dict[key], `${code}.${key}`).toBeTruthy();
        expect(vars(dict[key]), `${code}.${key}`).toEqual(vars(en[key]));
      }
    });
  }
});
