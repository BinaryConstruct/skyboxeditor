/**
 * Analytic surface-brightness and density profiles for the galaxy / cluster
 * generators. Pure math, no canvas — so they unit-test for determinism and
 * correct limiting behavior without a 2D context. Formulas and constants come
 * from docs/PCG-SAMPLES-RESEARCH.md (§2.1 Sérsic, §2.2 sech² edge-on disk,
 * §2.6 Plummer/King cluster).
 */

/**
 * Sérsic b_n: the constant that makes Re the half-light radius. The research
 * doc quotes the classic `b_n ≈ 2n − 1/3`; the Ciotti & Bertin expansion used
 * here adds the next terms so the n=4 de Vaucouleurs core is peaked correctly
 * (2n−1/3 is ~1 % low at n=4).
 */
export function sersicBn(n: number): number {
  return 2 * n - 1 / 3 + 4 / (405 * n) + 46 / (25515 * n * n);
}

/**
 * Sérsic surface brightness normalized so I(Re) = 1:
 *   I(r) = exp( −b_n · ((r/Re)^(1/n) − 1) )
 * n=4 (de Vaucouleurs) gives a very peaky core + huge soft halo; n=1 is an
 * exponential disk.
 */
export function sersicIntensity(r: number, Re: number, n: number): number {
  if (Re <= 0) return 0;
  const bn = sersicBn(n);
  return Math.exp(-bn * (Math.pow(r / Re, 1 / n) - 1));
}

/** sech²(x) = 1/cosh²(x): the standard vertical profile of an edge-on stellar disk. */
export function sech2(x: number): number {
  const c = Math.cosh(x);
  return 1 / (c * c);
}

/**
 * Plummer inverse-CDF radius sampler: for u uniform in (0,1),
 *   r = a / sqrt(u^(−2/3) − 1)
 * draws a 3D radius from the Plummer density with scale radius `a`. Small u →
 * small r (concentrated core); u → 1 → large r (diffuse halo).
 */
export function plummerRadius(u: number, a: number): number {
  const uu = Math.min(1 - 1e-9, Math.max(1e-9, u));
  return a / Math.sqrt(Math.pow(uu, -2 / 3) - 1);
}

/**
 * King-like radial weight with a finite tidal radius rt: 1 at the center,
 * falling to 0 at rt (the key improvement over Plummer's infinite halo). Used
 * to taper the sampled cluster so stars don't scatter past the tidal cutoff.
 */
export function kingWeight(r: number, rc: number, rt: number): number {
  if (r >= rt) return 0;
  const a = 1 / Math.sqrt(1 + (r / rc) * (r / rc));
  const b = 1 / Math.sqrt(1 + (rt / rc) * (rt / rc));
  const w = a - b;
  return w > 0 ? w * w : 0;
}
