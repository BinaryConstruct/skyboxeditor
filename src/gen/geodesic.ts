/**
 * Planar Schwarzschild null-geodesic integrator (units: rs = 1).
 *
 * A light ray around a non-spinning black hole stays in the 2D "orbital"
 * plane spanned by its position and direction (relative to the hole), so a
 * full 3D trace reduces to integrating (r, phi, dr, dphi) with the conserved
 * energy E — the technique used by hexontos/rendering-black-hole. RK4 with an
 * adaptive step (fine near the photon sphere, coarse when far/receding, as in
 * HollowaySean/BlackHoleViz_v2) keeps it accurate through ring windings.
 *
 * Two consumers:
 * - the PCG black-hole baker: parallel camera rays mean the trajectory is a
 *   function of the impact parameter b alone, so it traces one trajectory per
 *   b (as r sampled on a uniform phi grid) and intersects that curve with the
 *   tilted disc plane analytically per pixel;
 * - the positional lens layer: total deflection angle as a 1D LUT over
 *   theta/thetaShadow, replacing the weak-field point-lens formula.
 *
 * Pure math, no randomness — fully deterministic.
 */

/** Critical impact parameter: rays with b below this fall in (rs = 1). */
export const CRITICAL_B = (3 * Math.sqrt(3)) / 2;

export interface PlanarTrajectory {
  b: number;
  captured: boolean;
  /** r sampled at phi = (i + 1) * phiStep from the start point. */
  rOfPhi: Float32Array;
  phiStep: number;
  /** phi where the trace ended (capture, escape, or winding cap). */
  phiEnd: number;
  /** escaped rays: total bend angle vs. the incoming straight line (rad). */
  bend: number;
}

export interface TraceOpts {
  /** start/escape distance in rs (rays begin at (b, -r0) travelling +y) */
  r0?: number;
  /** phi grid resolution for the stored r(phi) curve */
  phiStep?: number;
  /** give up (treat as captured) after this much winding */
  phiMax?: number;
}

/** d/dlambda of the planar state [r, phi, dr, dphi] (hexontos form, rs = 1). */
function derivatives(r: number, dr: number, dphi: number, E: number, out: Float64Array): void {
  const rc = Math.max(r, 0.6); // keep f finite through the last capture step
  const f = 1 - 1 / rc;
  const dt = E / f;
  out[0] = dr;
  out[1] = dphi;
  out[2] = -(0.5 / (rc * rc)) * f * dt * dt
    + (0.5 / (rc * rc * f)) * dr * dr
    + (rc - 1) * dphi * dphi;
  out[3] = -2 * dr * dphi / rc;
}

/**
 * Trace one ray. Start: 2D plane, BH at origin, ray at (b, -r0) travelling
 * (0, +1); phi is measured from the start position, increasing along travel.
 */
export function tracePlanar(b: number, opts: TraceOpts = {}): PlanarTrajectory {
  const r0 = opts.r0 ?? 60;
  const phiStep = opts.phiStep ?? Math.PI / 512;
  const phiMax = opts.phiMax ?? 6 * Math.PI;

  // initial polar state from the Cartesian setup
  let r = Math.hypot(b, r0);
  let phi = 0;
  let dr = -r0 / r;          // dot(dir, radialAxis)
  let dphi = b / (r * r);    // dot(dir, tangentialAxis) / r
  const f0 = 1 - 1 / r;
  const E = f0 * Math.sqrt((dr * dr) / (f0 * f0) + (r * r * dphi * dphi) / f0);

  const escapeR = r + 1;
  const samples: number[] = [];
  let nextPhi = phiStep;
  let captured = false;

  const k1 = new Float64Array(4), k2 = new Float64Array(4);
  const k3 = new Float64Array(4), k4 = new Float64Array(4);

  for (let step = 0; step < 20000; step++) {
    // adaptive step: fine near the photon sphere, r-scaled far out, and never
    // sweeping more than ~2 phi-grid cells so the stored curve stays smooth
    let dl = Math.min(0.5 * r, Math.max(0.03, 0.35 * (r - 1)));
    if (Math.abs(dphi) > 1e-9) dl = Math.min(dl, (2 * phiStep) / Math.abs(dphi));

    const pr = r, pphi = phi, pdr = dr, pdphi = dphi;
    derivatives(r, dr, dphi, E, k1);
    derivatives(r + k1[0] * dl / 2, dr + k1[2] * dl / 2, dphi + k1[3] * dl / 2, E, k2);
    derivatives(r + k2[0] * dl / 2, dr + k2[2] * dl / 2, dphi + k2[3] * dl / 2, E, k3);
    derivatives(r + k3[0] * dl, dr + k3[2] * dl, dphi + k3[3] * dl, E, k4);
    r += (dl / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    phi += (dl / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    dr += (dl / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    dphi += (dl / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

    // record r at every phi grid point crossed this step (linear in phi)
    while (nextPhi <= phi) {
      const t = (nextPhi - pphi) / Math.max(1e-12, phi - pphi);
      samples.push(pr + (r - pr) * t);
      nextPhi += phiStep;
    }

    if (r <= 1.02) { captured = true; break; }
    if (phi >= phiMax) { captured = true; break; } // stuck winding the ring
    if (r >= escapeR && dr > 0) break;
    void pdr; void pdphi;
  }

  // total bend: world velocity angle = (radial-basis angle) + local flight
  // angle psi = atan2(r*dphi, dr), and the radial basis rotates with phi, so
  // bend = (phi_end + psi_end) - psi_start with psi_start = atan2(b, -r0)
  // EXACTLY (approximating psi_start as pi is itself an O(b/r0) error — the
  // same order as the weak-field deflection being measured)
  let bend = 0;
  if (!captured) {
    bend = Math.abs(phi + Math.atan2(r * dphi, dr) - Math.atan2(b, -r0));
  }

  return { b, captured, rOfPhi: Float32Array.from(samples), phiStep, phiEnd: phi, bend };
}

/** r at a given phi along a trajectory (linear interp), or NaN outside it. */
export function radiusAtPhi(traj: PlanarTrajectory, phi: number): number {
  if (phi <= 0 || phi >= traj.phiEnd) return NaN;
  const x = phi / traj.phiStep - 1;
  const i = Math.floor(x);
  if (i < 0) {
    // between the start point and the first grid sample: r0 is huge and the
    // disc never reaches it, so just report the first sample
    return traj.rOfPhi.length ? traj.rOfPhi[0] : NaN;
  }
  if (i >= traj.rOfPhi.length - 1) return traj.rOfPhi[traj.rOfPhi.length - 1] ?? NaN;
  const t = x - i;
  return traj.rOfPhi[i] * (1 - t) + traj.rOfPhi[i + 1] * t;
}

/** dr/dphi at phi (finite difference on the stored curve), 0 at the ends. */
export function slopeAtPhi(traj: PlanarTrajectory, phi: number): number {
  const h = traj.phiStep;
  const a = radiusAtPhi(traj, phi - h);
  const b = radiusAtPhi(traj, phi + h);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / (2 * h);
}

/**
 * Deflection LUT for the lens shader: bend angle sampled over
 * x = b/CRITICAL_B in (1, xMax], packed densely near the photon ring where
 * the bend diverges logarithmically. Entry i uses x = 1 + u^2 (xMax - 1) with
 * u = (i + 0.5) / n.
 */
export function buildDeflectionLut(n = 256, xMax = 9): Float32Array {
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const x = 1 + u * u * (xMax - 1);
    const t = tracePlanar(x * CRITICAL_B, { phiStep: Math.PI / 256 });
    // captured (only possible via the winding cap at the very first entries):
    // carry the neighbour forward so the LUT stays monotone-ish and finite
    lut[i] = t.captured ? (i > 0 ? lut[i - 1] : 2 * Math.PI) : t.bend;
  }
  return lut;
}

/**
 * 2D trajectory LUT for shader-side disc rendering: r (in rs) sampled over
 * impact parameter b (X, linear 0..bMax) and swept angle phi (Y, linear
 * 0..phiMax), traced from a camera at r0. Two channels per texel: [radius,
 * validity]. Past a trajectory's end the radius HOLDS its last value (so
 * linear filtering never interpolates through a disc's radius range - a
 * sentinel would) and validity drops to 0; shaders reject crossings whose
 * bilinear-blended validity falls below ~0.75. This is the sprite baker's
 * algorithm packaged for a fragment shader: a disc-plane crossing at known
 * phi becomes a single texture fetch.
 */
export interface TrajectoryLut {
  data: Float32Array;
  nB: number;
  nPhi: number;
  bMax: number;
  phiMax: number;
}

export function buildTrajectoryLut(
  r0: number,
  nB = 384,
  nPhi = 160,
  bMax = 28,
  phiMax = 3 * Math.PI,
): TrajectoryLut {
  const data = new Float32Array(nB * nPhi * 2);
  for (let i = 0; i < nB; i++) {
    const b = ((i + 0.5) / nB) * bMax;
    const t = tracePlanar(b, { r0, phiStep: Math.PI / 512, phiMax });
    let hold = t.rOfPhi.length ? t.rOfPhi[t.rOfPhi.length - 1] : r0;
    for (let j = 0; j < nPhi; j++) {
      const phi = ((j + 0.5) / nPhi) * phiMax;
      const r = radiusAtPhi(t, phi);
      const valid = !Number.isNaN(r);
      if (valid) hold = r;
      data[(j * nB + i) * 2] = valid ? r : hold;
      data[(j * nB + i) * 2 + 1] = valid ? 1 : 0;
    }
  }
  return { data, nB, nPhi, bMax, phiMax };
}
