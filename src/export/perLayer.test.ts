import { describe, expect, it } from 'vitest';
import { defaultLayer } from '../core/layers';
import {
  compositeEntry, compositeJson, layerFileStem, starDataCsv, starDataJson,
  type StarData,
} from './perLayer';

const sample: StarData = {
  positions: new Float32Array([0.1, -0.5, 0.86, 0, 1, 0]),
  colors: new Float32Array([1, 0.5, 0.25, 1, 0, 0, 1, 0.5]),
  sizes: new Float32Array([2.5, 4]),
  count: 2,
  sizeUnit: 'pixels',
};

describe('starDataJson', () => {
  it('serializes counts, units, and flat arrays', () => {
    const parsed = JSON.parse(starDataJson('My Stars', sample));
    expect(parsed.layer).toBe('My Stars');
    expect(parsed.count).toBe(2);
    expect(parsed.units.size).toBe('pixels');
    expect(parsed.positions).toHaveLength(6);
    expect(parsed.colors).toHaveLength(8);
    expect(parsed.sizes).toEqual([2.5, 4]);
    // float32 noise trimmed: 0.1 stays a short literal
    expect(parsed.positions[0]).toBe(0.1);
  });
});

describe('starDataCsv', () => {
  it('one header + one row per star, 8 columns', () => {
    const lines = starDataCsv(sample).trim().split('\n');
    expect(lines[0]).toBe('x,y,z,r,g,b,a,size');
    expect(lines).toHaveLength(3);
    expect(lines[1].split(',')).toHaveLength(8);
    expect(lines[2].split(',')[7]).toBe('4');
  });
});

describe('composite manifest', () => {
  it('records order, type, blend factors, and billboard texture', () => {
    const noise = defaultLayer('noise', 'Blue Nebula');
    const flares = defaultLayer('billboards', 'Flares');
    const entries = [compositeEntry(noise, 0), compositeEntry(flares, 1)];
    const parsed = JSON.parse(compositeJson({ preset: 'p', faceSize: 512 }, entries));
    expect(parsed.format).toBe('spacescape-web-composite');
    expect(parsed.layers[0]).toMatchObject({
      index: 0,
      name: 'Blue Nebula',
      type: 'noise',
      blend: { source: 'one', dest: 'one' },
    });
    expect(parsed.layers[1].texture).toBeDefined();
    expect(parsed.layers[0].texture).toBeUndefined();
  });
});

describe('layerFileStem', () => {
  it('index-prefixes and slugs the name', () => {
    const l = defaultLayer('noise', 'Pink & Purple Nebula!');
    expect(layerFileStem(l, 1)).toBe('02-pink-purple-nebula');
  });
  it('falls back to the type for symbol-only names', () => {
    const l = defaultLayer('points', '***');
    expect(layerFileStem(l, 0)).toBe('01-points');
  });
});
