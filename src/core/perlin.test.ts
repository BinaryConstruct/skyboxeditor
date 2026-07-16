import { describe, expect, it } from 'vitest';
import { PerlinNoise, ridge } from './perlin';

describe('PerlinNoise', () => {
  it('builds a valid duplicated permutation table', () => {
    const p = new PerlinNoise(0);
    const first = Array.from(p.perm.slice(0, 256));
    expect([...first].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 256 }, (_, i) => i),
    );
    for (let i = 0; i < 256; i++) {
      expect(p.perm[i + 256]).toBe(p.perm[i]);
    }
  });

  it('permutation table is deterministic per seed and varies across seeds', () => {
    const a = new PerlinNoise(0);
    const b = new PerlinNoise(0);
    const c = new PerlinNoise(1);
    expect(Array.from(a.perm)).toEqual(Array.from(b.perm));
    expect(Array.from(a.perm)).not.toEqual(Array.from(c.perm));
  });

  // Locks the exact table produced by seed 0 (MSVC LCG + swap shuffle).
  // If this ever changes, legacy-save parity is broken.
  it('perm table for seed 0 is stable', () => {
    const p = new PerlinNoise(0);
    expect(Array.from(p.perm.slice(0, 512))).toMatchSnapshot();
  });

  it('noise is zero-ish at lattice points and bounded between them', () => {
    const p = new PerlinNoise(42);
    expect(p.noise(1, 2, 3)).toBeCloseTo(0, 10);
    for (let i = 0; i < 500; i++) {
      const n = p.noise(i * 0.137, i * 0.291, i * 0.113);
      expect(Math.abs(n)).toBeLessThan(2);
    }
  });

  it('fbm and ridged fbm values are stable per seed', () => {
    const p = new PerlinNoise(0);
    const samples: Record<string, number> = {};
    for (const [x, y, z] of [
      [0.1, 0.2, 0.3],
      [0.5, 0.5, 0.5],
      [-0.7, 0.33, 0.9],
    ] as const) {
      samples[`fbm(${x},${y},${z})`] = p.fbm(x, y, z, 8, 0.5, 2.0);
      samples[`ridged(${x},${y},${z})`] = p.ridgedFbm(x, y, z, 8, 0.5, 2.0, 1.0);
    }
    expect(samples).toMatchSnapshot();
  });

  it('ridge matches (offset - |n|)^2', () => {
    expect(ridge(0.5, 1.0)).toBeCloseTo(0.25, 12);
    expect(ridge(-0.5, 1.0)).toBeCloseTo(0.25, 12);
    expect(ridge(0, 2)).toBe(4);
  });

  it('perm/grad GPU lookup textures have the right shape and derive from perm', () => {
    const p = new PerlinNoise(0);
    const perm = p.buildPermTexture();
    const grad = p.buildGradTexture();
    expect(perm.length).toBe(256 * 256 * 4);
    expect(grad.length).toBe(256 * 3);
    // spot-check the documented packing at (X=0, Y=0)
    const A = p.perm[0];
    expect(perm[0]).toBe(p.perm[A]);
    expect(perm[1]).toBe(p.perm[A + 1]);
    const B = p.perm[1];
    expect(perm[2]).toBe(p.perm[B]);
    expect(perm[3]).toBe(p.perm[B + 1]);
  });
});
