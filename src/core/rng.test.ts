import { describe, expect, it } from 'vitest';
import { MsvcRng, RAND_MAX } from './rng';

describe('MsvcRng', () => {
  it('reproduces the well-known MSVC rand() sequence for srand(1)', () => {
    const r = new MsvcRng();
    r.srand(1);
    expect([r.rand(), r.rand(), r.rand(), r.rand(), r.rand()]).toEqual([
      41, 18467, 6334, 26500, 19169,
    ]);
  });

  it('matches the LCG formula for srand(0)', () => {
    // 0 * 214013 + 2531011 = 2531011; 2531011 >> 16 = 38
    const r = new MsvcRng(0);
    expect(r.rand()).toBe(38);
  });

  it('stays within [0, RAND_MAX]', () => {
    const r = new MsvcRng(12345);
    for (let i = 0; i < 10000; i++) {
      const v = r.rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RAND_MAX);
    }
  });

  it('is deterministic per seed and resets via srand', () => {
    const a = new MsvcRng(777);
    const first = [a.rand(), a.rand(), a.rand()];
    a.srand(777);
    expect([a.rand(), a.rand(), a.rand()]).toEqual(first);

    const b = new MsvcRng(778);
    expect([b.rand(), b.rand(), b.rand()]).not.toEqual(first);
  });

  it('handles 32-bit wraparound (large seeds)', () => {
    const r = new MsvcRng(0xffffffff);
    for (let i = 0; i < 100; i++) {
      const v = r.rand();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RAND_MAX);
    }
  });
});
