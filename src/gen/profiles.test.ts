import { describe, expect, it } from 'vitest';
import { kingWeight, plummerRadius, sech2, sersicBn, sersicIntensity } from './profiles';

describe('sersicIntensity', () => {
  it('is 1 at the effective radius by construction', () => {
    expect(sersicIntensity(10, 10, 4)).toBeCloseTo(1, 10);
    expect(sersicIntensity(25, 25, 1)).toBeCloseTo(1, 10);
  });

  it('has a much peakier core for n=4 than n=1 (de Vaucouleurs vs exponential)', () => {
    const core4 = sersicIntensity(0.01, 10, 4);
    const core1 = sersicIntensity(0.01, 10, 1);
    // both are brighter than at Re, but n=4 is dramatically more concentrated
    expect(core4).toBeGreaterThan(core1);
    expect(core4 / core1).toBeGreaterThan(50);
  });

  it('falls off monotonically with radius', () => {
    let prev = Infinity;
    for (let r = 1; r <= 60; r += 3) {
      const v = sersicIntensity(r, 15, 4);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('bn matches the classic 2n-1/3 to first order', () => {
    expect(sersicBn(4)).toBeCloseTo(7.669, 1); // known de Vaucouleurs value ≈ 7.669
  });
});

describe('sech2', () => {
  it('peaks at 1 on the midplane and decays symmetrically', () => {
    expect(sech2(0)).toBeCloseTo(1, 10);
    expect(sech2(1)).toBeCloseTo(sech2(-1), 12);
    expect(sech2(2)).toBeLessThan(sech2(1));
  });
});

describe('plummerRadius', () => {
  it('is monotonic increasing in u and spans the core-to-halo range', () => {
    const rSmall = plummerRadius(0.1, 5);
    const rMid = plummerRadius(0.5, 5);
    const rLarge = plummerRadius(0.9, 5);
    expect(rSmall).toBeLessThan(rMid);
    expect(rMid).toBeLessThan(rLarge);
  });

  it('returns the scale radius near the median of the enclosed-mass CDF', () => {
    // Plummer half-mass radius ≈ 1.305·a; the u=0.5 draw sits near there
    const r = plummerRadius(0.5, 1);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(1.6);
  });
});

describe('kingWeight', () => {
  it('is positive inside the tidal radius and zero at/beyond it', () => {
    expect(kingWeight(0, 2, 20)).toBeGreaterThan(0);
    expect(kingWeight(19.9, 2, 20)).toBeGreaterThanOrEqual(0);
    expect(kingWeight(20, 2, 20)).toBe(0);
    expect(kingWeight(25, 2, 20)).toBe(0);
  });

  it('decreases from center toward the tidal edge', () => {
    expect(kingWeight(1, 2, 20)).toBeGreaterThan(kingWeight(10, 2, 20));
  });
});
