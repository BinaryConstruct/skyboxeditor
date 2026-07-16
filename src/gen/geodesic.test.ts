import { describe, expect, it } from 'vitest';
import { CRITICAL_B, buildDeflectionLut, radiusAtPhi, tracePlanar } from './geodesic';

describe('planar Schwarzschild geodesics', () => {
  it('matches the analytic weak-field deflection 2rs/b at large b', () => {
    for (const b of [30, 50, 80]) {
      const t = tracePlanar(b, { r0: 2000 });
      expect(t.captured).toBe(false);
      // second-order expansion (rs = 1): alpha = 2/b + 15*pi/(16*b^2) — the
      // integrator reproduces the 1/b^2 term, so first-order alone is not a
      // fair reference (it is ~5% low already at b = 30)
      const analytic = 2 / b + (15 * Math.PI) / (16 * b * b);
      expect(Math.abs(t.bend - analytic) / analytic).toBeLessThan(0.02);
    }
  });

  it('captures rays below the critical impact parameter and not above', () => {
    expect(tracePlanar(CRITICAL_B * 0.8).captured).toBe(true);
    expect(tracePlanar(CRITICAL_B * 1.2).captured).toBe(false);
  });

  it('bend decreases monotonically with impact parameter', () => {
    const bends = [3, 4, 6, 10, 20].map((b) => tracePlanar(b).bend);
    for (let i = 1; i < bends.length; i++) {
      expect(bends[i]).toBeLessThan(bends[i - 1]);
    }
  });

  it('bends stronger than weak-field near the photon ring', () => {
    const t = tracePlanar(CRITICAL_B * 1.05);
    expect(t.captured).toBe(false);
    expect(t.bend).toBeGreaterThan(Math.PI / 2); // strong-field winding
  });

  it('closest approach on the stored curve is near the impact parameter', () => {
    const b = 8;
    const t = tracePlanar(b);
    let rMin = Infinity;
    for (const r of t.rOfPhi) rMin = Math.min(rMin, r);
    // light dips slightly inside b (gravity pulls it in), never far below
    expect(rMin).toBeLessThanOrEqual(b);
    expect(rMin).toBeGreaterThan(b * 0.7);
  });

  it('radiusAtPhi interpolates inside the swept range and NaNs outside', () => {
    const t = tracePlanar(6);
    const mid = t.phiEnd / 2;
    expect(Number.isFinite(radiusAtPhi(t, mid))).toBe(true);
    expect(Number.isNaN(radiusAtPhi(t, t.phiEnd + 1))).toBe(true);
    expect(Number.isNaN(radiusAtPhi(t, -0.1))).toBe(true);
  });

  it('builds a finite, decreasing deflection LUT', () => {
    const lut = buildDeflectionLut(64);
    for (const v of lut) expect(Number.isFinite(v)).toBe(true);
    // ignore the first few entries (winding-cap carry-forward), then strictly
    // decreasing toward the weak field
    for (let i = 8; i < lut.length; i++) {
      expect(lut[i]).toBeLessThan(lut[i - 1] + 1e-9);
    }
    expect(lut[lut.length - 1]).toBeLessThan(0.5);
  });
});

describe('trajectory LUT', () => {
  it('records sane crossing radii and marks ended trajectories with 0', async () => {
    const { buildTrajectoryLut } = await import('./geodesic');
    const lut = buildTrajectoryLut(30, 48, 64, 20);
    const at = (i: number, j: number) => lut.data[(j * 48 + i) * 2];
    const validAt = (i: number, j: number) => lut.data[(j * 48 + i) * 2 + 1];
    // a mid-range impact parameter: r at small phi is near the camera
    // distance and decreases toward closest approach
    const i = Math.floor((8 / 20) * 48); // b ~ 8
    expect(at(i, 1)).toBeGreaterThan(15);
    let rMin = Infinity;
    let invalids = 0;
    for (let j = 0; j < 64; j++) {
      if (validAt(i, j) < 1) { invalids++; continue; }
      rMin = Math.min(rMin, at(i, j));
    }
    expect(rMin).toBeLessThan(9);
    expect(rMin).toBeGreaterThan(5);
    expect(invalids).toBeGreaterThan(0); // escaped before phiMax
    // invalid entries HOLD the last radius (no sentinel jumps for linear
    // filtering to sweep through disc radii) and carry validity 0
    const ic = Math.floor((1.5 / 20) * 48);
    expect(validAt(ic, 0)).toBe(1);
    expect(validAt(ic, 63)).toBe(0);
    expect(at(ic, 63)).toBeGreaterThan(0.9); // held near the capture radius
    expect(at(ic, 63)).toBeLessThan(2);
  });
});
