/** Every web language has every text, and keeps the same {placeholders} as English. */
import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import es from '../../src/i18n/es-MX';
import fr from '../../src/i18n/fr-CA';
import pa from '../../src/i18n/pa';
import hi from '../../src/i18n/hi';
import gu from '../../src/i18n/gu';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('web translations', () => {
  for (const [code, dict] of Object.entries({ 'es-MX': es, 'fr-CA': fr, pa, hi, gu })) {
    it(`${code}: complete, nothing empty, same {placeholders}`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(dict[key], `${code}.${key}`).toBeTruthy();
        expect(vars(dict[key]), `${code}.${key}`).toEqual(vars(en[key]));
      }
      expect(Object.keys(dict).length).toBe(Object.keys(en).length);
    });
  }
  it('no Alberta-specific wording is left', () => {
    for (const dict of [en, es, fr, pa, hi, gu]) expect(JSON.stringify(dict)).not.toMatch(/Alberta|CPP|\bEI\b/);
  });
});
