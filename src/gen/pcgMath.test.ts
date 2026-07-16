import { describe, expect, it } from 'vitest';
import {
  SPECTRAL_KELVIN, beamIntensity, dipoleRadius, dopplerFactor, geometricSeries, wienPeakNm,
} from './pcgMath';

describe('geometricSeries', () => {
  it('produces r0·ratio^k with the right length', () => {
    expect(geometricSeries(2, 1.5, 4)).toEqual([2, 3, 4.5, 6.75]);
  });
  it('is empty for count 0 and grows outward for ratio>1', () => {
    expect(geometricSeries(5, 1.6, 0)).toEqual([]);
    const s = geometricSeries(1, 1.6, 5);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });
});

describe('dipoleRadius', () => {
  it('is maximal L at the magnetic equator and closes at the poles', () => {
    expect(dipoleRadius(10, Math.PI / 2)).toBeCloseTo(10, 10);
    expect(dipoleRadius(10, 0)).toBeCloseTo(0, 10);
    expect(dipoleRadius(10, Math.PI)).toBeCloseTo(0, 10);
  });
  it('follows sin²θ', () => {
    expect(dipoleRadius(4, Math.PI / 6)).toBeCloseTo(4 * 0.25, 10); // sin30=0.5
  });
});

describe('beamIntensity', () => {
  it('is zero behind the origin and peaks on-axis for a solid beam', () => {
    expect(beamIntensity(-1, 0, 4, 0.1, 100)).toBe(0);
    const onAxis = beamIntensity(10, 0, 4, 0.1, 100);
    const offAxis = beamIntensity(10, 6, 4, 0.1, 100);
    expect(onAxis).toBeGreaterThan(offAxis);
  });
  it('decays along the axis via the exponential length falloff', () => {
    expect(beamIntensity(80, 0, 4, 0.1, 40)).toBeLessThan(beamIntensity(10, 0, 4, 0.1, 40));
  });
  it('hollow cone pushes the peak off the axis toward the rim', () => {
    // at the beam center a fully hollow cone is dimmer than on the flank
    const center = beamIntensity(10, 0, 8, 0, 100, 1);
    const flank = beamIntensity(10, 8, 8, 0, 100, 1); // u=1 → shape peak
    expect(flank).toBeGreaterThan(center);
  });
});

describe('dopplerFactor', () => {
  it('brightens the approaching side and dims the receding side', () => {
    expect(dopplerFactor(Math.PI / 2, 0.9)).toBeCloseTo(1.9, 10);
    expect(dopplerFactor(-Math.PI / 2, 0.9)).toBeCloseTo(0.1, 10);
  });
  it('never goes negative', () => {
    expect(dopplerFactor(-Math.PI / 2, 2)).toBe(0);
  });
});

describe('wienPeakNm + spectral table', () => {
  it('orders the OBAFGKM sequence hot→cool (kelvin) and blue→red (peak nm)', () => {
    const order: (keyof typeof SPECTRAL_KELVIN)[] = ['o', 'b', 'a', 'f', 'g', 'k', 'm'];
    for (let i = 1; i < order.length; i++) {
      expect(SPECTRAL_KELVIN[order[i]]).toBeLessThan(SPECTRAL_KELVIN[order[i - 1]]);
      // cooler star → longer (redder) peak wavelength
      expect(wienPeakNm(SPECTRAL_KELVIN[order[i]]))
        .toBeGreaterThan(wienPeakNm(SPECTRAL_KELVIN[order[i - 1]]));
    }
  });
  it('puts the Sun (G, 5800 K) peak in the visible green', () => {
    expect(wienPeakNm(5800)).toBeGreaterThan(450);
    expect(wienPeakNm(5800)).toBeLessThan(560);
  });
});
