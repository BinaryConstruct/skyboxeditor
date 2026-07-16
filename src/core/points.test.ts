import { describe, expect, it } from 'vitest';
import { defaultPointsLayer, rgba } from './layers';
import { generatePoints } from './points';

describe('generatePoints', () => {
  it('generates numPoints stars on the unit sphere, deterministically', () => {
    const layer = { ...defaultPointsLayer(), numPoints: 500, seed: 7 };
    const a = generatePoints(layer);
    const b = generatePoints(layer);

    expect(a.positions.length).toBe(500 * 3);
    expect(a.colors.length).toBe(500 * 4);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));

    for (let i = 0; i < 500; i++) {
      const x = a.positions[i * 3];
      const y = a.positions[i * 3 + 1];
      const z = a.positions[i * 3 + 2];
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 5);
    }
  });

  it('different seeds give different skies', () => {
    const a = generatePoints({ ...defaultPointsLayer(), numPoints: 100, seed: 1 });
    const b = generatePoints({ ...defaultPointsLayer(), numPoints: 100, seed: 2 });
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });

  it('colors lerp between nearColor and farColor (all channels)', () => {
    const layer = {
      ...defaultPointsLayer(),
      numPoints: 200,
      seed: 3,
      nearColor: rgba(1, 0.5, 0, 1),
      farColor: rgba(0, 0.5, 1, 0),
    };
    const { colors } = generatePoints(layer);
    for (let i = 0; i < 200; i++) {
      const r = colors[i * 4];
      const g = colors[i * 4 + 1];
      const b = colors[i * 4 + 2];
      const a = colors[i * 4 + 3];
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeCloseTo(0.5, 6);
      // b and a are lerped by the same t as r: b = 1-r, a = r
      expect(b).toBeCloseTo(1 - r, 5);
      expect(a).toBeCloseTo(r, 5);
    }
  });

  it('first star for seed 0 is stable', () => {
    const { positions } = generatePoints({ ...defaultPointsLayer(), numPoints: 1, seed: 0 });
    expect(Array.from(positions)).toMatchSnapshot();
  });
});
