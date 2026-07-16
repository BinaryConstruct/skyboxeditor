/**
 * Pure math building blocks shared by the stellar / anomaly sprite bakers and
 * the composable PCG component-layer library (docs/StellarObjectResearch2.md
 * §7, docs/PCG-STELLAR-STYLES-PLAN.md §5–6). No canvas here — every function
 * is deterministic and unit-testable in the node env, unlike the per-pixel
 * bakers which need a 2D context.
 */

/**
 * Geometric radius series r_k = r0 · ratio^k, k = 0..count-1. The workhorse
 * for concentric structure that reads as "natural" at a glance: HL Tau's disc
 * gaps (§5.2), magnetar dipole field-line shells (§6.9), and the knot chain
 * spacing along a jet (§6.7). `ratio > 1` grows outward.
 */
export function geometricSeries(r0: number, ratio: number, count: number): number[] {
  const out: number[] = [];
  let r = r0;
  for (let k = 0; k < count; k++) {
    out.push(r);
    r *= ratio;
  }
  return out;
}

/**
 * Dipole field-line radius r(θ) = L · sin²θ, where θ is magnetic colatitude
 * and L is the equatorial crossing radius (§6.9). θ = π/2 (equator) gives the
 * maximum r = L; θ → 0/π (poles) closes the loop to the star. This is the
 * exact shape of an ideal magnetic dipole field line, drawn as the magnetar's
 * glowing loop cage.
 */
export function dipoleRadius(L: number, theta: number): number {
  const s = Math.sin(theta);
  return L * s * s;
}

/**
 * Elongated-beam intensity in beam-local coordinates: ℓ along the axis from
 * the origin (ℓ ≥ 0), d perpendicular. Gaussian cross-section whose half-width
 * opens linearly with ℓ, times an exponential length falloff (§6 shared
 * primitive — pulsar/quasar/jet workhorse). `hollow` in [0,1] mixes a solid
 * Gaussian cross-section toward a rim-Gaussian centered at |d| = w, so a
 * hollow cone genuinely peaks off-axis at the cone wall (pulsar radio beams
 * are brightest at the rim — arXiv:astro-ph/9904336).
 */
export function beamIntensity(
  l: number, d: number, w0: number, wSlope: number, L: number, hollow = 0,
): number {
  if (l < 0) return 0;
  const w = w0 + wSlope * l;
  if (w <= 0) return 0;
  const u = Math.abs(d) / w;
  const solid = Math.exp(-u * u);
  const rim = Math.exp(-((u - 1) * (u - 1)) / 0.35); // peak at the cone wall
  const cross = (1 - hollow) * solid + hollow * rim;
  const lengthFalloff = Math.exp(-l / Math.max(1e-6, L));
  return cross * lengthFalloff;
}

/**
 * Relativistic-ish Doppler side-brightening factor for a rotating disc /
 * jet: 1 + amount·sin(azimuth). The approaching side (sin > 0) brightens, the
 * receding side dims — the same term the positional black-hole disc shader
 * uses. Clamped to stay non-negative.
 */
export function dopplerFactor(azimuth: number, amount: number): number {
  return Math.max(0, 1 + amount * Math.sin(azimuth));
}

/**
 * Wien's displacement law peak wavelength (nm) for a blackbody at T kelvin,
 * b = 2.897771955e-3 m·K. Not used for color (that's kelvinToRgb) but handy
 * for validating the spectral ordering of the sun styles.
 */
export function wienPeakNm(kelvin: number): number {
  return (2.897771955e-3 / kelvin) * 1e9;
}

/**
 * Kelvin anchors for the O B A F G K M main-sequence spectral sequence
 * (docs/PCG-STELLAR-STYLES-PLAN.md §3). Monotonic decreasing O→M. Exported so
 * the ordering can be asserted and reused by both the legacy sun baker and the
 * composable photosphere layer.
 */
export const SPECTRAL_KELVIN: Record<'o' | 'b' | 'a' | 'f' | 'g' | 'k' | 'm', number> = {
  o: 40000,
  b: 16000,
  a: 8500,
  f: 6800,
  g: 5800,
  k: 4400,
  m: 3100,
};
