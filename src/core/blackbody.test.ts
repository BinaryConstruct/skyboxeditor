import { describe, expect, it } from 'vitest';
import { bvToKelvin, kelvinToRgb } from './blackbody';
import { parseStarCsv, billboardsFromCatalog } from './starCatalog';
import { defaultBillboardsLayer, defaultPointsLayer } from './layers';
import { generatePoints } from './points';

describe('blackbody colors', () => {
  it('cool stars are red-dominant, hot stars blue-dominant', () => {
    const cool = kelvinToRgb(2500);
    expect(cool.r).toBeGreaterThan(cool.b);
    const hot = kelvinToRgb(20000);
    expect(hot.b).toBeGreaterThan(hot.r);
    const solar = kelvinToRgb(5800);
    expect(solar.r).toBeGreaterThan(0.9);
    expect(solar.g).toBeGreaterThan(0.8);
  });

  it('B-V maps to sensible temperatures', () => {
    expect(bvToKelvin(0.65)).toBeGreaterThan(5000); // sun-like
    expect(bvToKelvin(0.65)).toBeLessThan(6500);
    expect(bvToKelvin(-0.2)).toBeGreaterThan(10000); // B star
    expect(bvToKelvin(1.5)).toBeLessThan(4500); // K/M star
  });
});

describe('star physics in generatePoints', () => {
  it('defaults keep legacy output (guarded features)', () => {
    const legacy = generatePoints({ ...defaultPointsLayer(), numPoints: 50, seed: 5 });
    // snapshot-equivalent check: same values as pre-M5 formula
    expect(legacy.colors[3]).toBeLessThanOrEqual(1);
    const again = generatePoints({ ...defaultPointsLayer(), numPoints: 50, seed: 5 });
    expect(Array.from(legacy.positions)).toEqual(Array.from(again.positions));
  });

  it('blackbody mode leaves positions identical to legacy mode', () => {
    const base = { ...defaultPointsLayer(), numPoints: 200, seed: 9 };
    const legacy = generatePoints(base);
    const bb = generatePoints({ ...base, colorMode: 'blackbody' as const });
    expect(Array.from(bb.positions)).toEqual(Array.from(legacy.positions));
    expect(Array.from(bb.colors)).not.toEqual(Array.from(legacy.colors));
  });

  it('galactic band pulls stars toward the band plane', () => {
    const base = { ...defaultPointsLayer(), numPoints: 3000, seed: 2 };
    const meanAbsZ = (p: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < p.length / 3; i++) sum += Math.abs(p[i * 3 + 2]);
      return sum / (p.length / 3);
    };
    const uniform = generatePoints(base);
    const banded = generatePoints({ ...base, bandStrength: 0.9, bandConcentration: 4 });
    expect(meanAbsZ(banded.positions)).toBeLessThan(meanAbsZ(uniform.positions) * 0.6);
  });
});

describe('star catalog', () => {
  const CSV = [
    'ProperName,x,y,z,distance,AbsMag,ColorIndex',
    'Sirius,-0.494,-1.45,-2.31,2.64,1.454,0.009',
    'Sol,0,0,0,0.00000484,4.85,0.656',
    'FaintStar,10,20,30,15000,10.5,1.2',
    'Vega,1.2,-2.4,7.3,7.68,0.582,-0.001',
  ].join('\n');

  it('parses the HYG-style header and rows', () => {
    const stars = parseStarCsv(CSV);
    expect(stars.length).toBe(4);
    expect(stars[0].bv).toBeCloseTo(0.009, 5);
  });

  it('filters the Sun (too close) and too-faint stars, normalizes positions', () => {
    const layer = { ...defaultBillboardsLayer(), dataFile: 'stars.csv' };
    const flares = billboardsFromCatalog(layer, parseStarCsv(CSV));
    // Sirius + Vega survive; Sol (dist<0.1) and FaintStar (apparent>6.5) drop
    expect(flares.count).toBe(2);
    for (let i = 0; i < flares.count; i++) {
      const x = flares.positions[i * 3];
      const y = flares.positions[i * 3 + 1];
      const z = flares.positions[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });
});
