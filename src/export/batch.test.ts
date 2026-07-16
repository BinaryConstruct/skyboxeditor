import { describe, expect, it } from 'vitest';
import { defaultLayer } from '../core/layers';
import { manifestEntry, variantLayers, variantSeed } from './batch';

describe('variantSeed', () => {
  it('k = 0 is the identity, verbatim — no uint32 coercion', () => {
    expect(variantSeed(12345, 0)).toBe(12345);
    expect(variantSeed(0, 0)).toBe(0);
    expect(variantSeed(-1, 0)).toBe(-1);
    expect(variantSeed(4294967296, 0)).toBe(4294967296);
  });

  it('is stable across runs (locked values)', () => {
    // regression lock: these exact values are the reproducibility contract —
    // a change here would silently re-seed users' existing batches
    expect(variantSeed(1, 1)).toBe(1399529528);
    expect(variantSeed(1, 2)).toBe(2172431747);
    expect(variantSeed(42, 1)).toBe(1969654179);
  });

  it('different k give different seeds, always uint32', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 32; k++) {
      const s = variantSeed(7, k);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(s)).toBe(true);
      seen.add(s);
    }
    expect(seen.size).toBe(32);
  });

  it('does not depend on anything but (seed, k)', () => {
    expect(variantSeed(99, 5)).toBe(variantSeed(99, 5));
  });
});

describe('variantLayers', () => {
  const stack = [defaultLayer('noise', 'neb'), defaultLayer('points', 'stars')];
  stack[0].seed = 11;
  stack[1].seed = 22;

  it('k = 0 keeps original seeds (including mask seeds)', () => {
    const v = variantLayers(stack, 0);
    expect(v[0].seed).toBe(11);
    expect(v[1].seed).toBe(22);
    expect((v[1] as { maskSeed: number }).maskSeed)
      .toBe((stack[1] as { maskSeed: number }).maskSeed);
  });

  it('re-seeds every layer, leaves everything else identical', () => {
    const v = variantLayers(stack, 3);
    expect(v[0].seed).toBe(variantSeed(11, 3));
    expect(v[1].seed).toBe(variantSeed(22, 3));
    for (let i = 0; i < stack.length; i++) {
      const a = { ...stack[i], seed: 0, maskSeed: 0 };
      const b = { ...v[i], seed: 0, maskSeed: 0 };
      expect(b).toEqual(a);
    }
  });

  it('varies mask seeds independently of layer seeds', () => {
    const points = defaultLayer('points', 'p');
    points.seed = 5;
    (points as unknown as { maskSeed: number }).maskSeed = 5; // deliberately equal
    const v = variantLayers([points], 2)[0] as unknown as { seed: number; maskSeed: number };
    expect(v.seed).toBe(variantSeed(5, 2));
    expect(v.maskSeed).toBe(variantSeed((5 ^ 0xa5a5) >>> 0, 2));
    expect(v.maskSeed).not.toBe(v.seed);
  });

  it('does not mutate the input stack', () => {
    variantLayers(stack, 9);
    expect(stack[0].seed).toBe(11);
    expect(stack[1].seed).toBe(22);
  });
});

describe('manifestEntry', () => {
  it('records 1-based variation number and per-layer seeds', () => {
    const v = variantLayers([defaultLayer('noise', 'neb')], 2);
    const m = manifestEntry(v, 2);
    expect(m.variation).toBe(3);
    expect(m.layerSeeds).toEqual([{ name: 'neb', seed: v[0].seed }]);
  });
});
