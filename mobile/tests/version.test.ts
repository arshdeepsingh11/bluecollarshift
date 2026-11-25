import { describe, expect, it } from 'vitest';
import { isOlder } from '../src/lib/version';

describe('isOlder', () => {
  it('compares numerically, not as text', () => {
    expect(isOlder('1.2.10', '1.10.0')).toBe(true);
    expect(isOlder('1.10.0', '1.2.10')).toBe(false);
    expect(isOlder('1.0.0', '1.0.0')).toBe(false);
    expect(isOlder('1.0', '1.0.1')).toBe(true);
    expect(isOlder('2.0.0', '1.9.9')).toBe(false);
  });
});
