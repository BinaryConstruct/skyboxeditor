/**
 * Hero galaxy layer: a deterministic spiral star-particle cloud in
 * unit-galaxy disc space (radius 1, disc in the xy plane). The render layer
 * orients and places it on the sky sphere.
 */
import { kelvinToRgb } from './blackbody';
import type { GalaxyLayer } from './layers';
import { MsvcRng } from './rng';

/** Soft textured blobs in unit-disc space (nebulae, dust clouds). */
export interface GalaxyBlobs {
  positions: Float32Array;
  /** blob radius as a fraction of the galaxy radius */
  sizes: Float32Array;
  /** rgba; for dust the alpha is the darkening strength */
  colors: Float32Array;
  count: number;
}

export interface GalaxyStars {
  /** xyz per star in unit-disc space (|xy| <= ~1, z = thickness) */
  positions: Float32Array;
  /** rgba per star */
  colors: Float32Array;
  /** pixel size per star */
  sizes: Float32Array;
  count: number;
  /** bright HII/reflection clumps on the arm knots (additive quads) */
  nebulae?: GalaxyBlobs;
  /** dark dust clouds along the inner arm edges (darkening quads) */
  dust?: GalaxyBlobs;
}

export function generateGalaxyStars(layer: GalaxyLayer): GalaxyStars {
  const rng = new MsvcRng(layer.seed >>> 0);
  const n = Math.max(0, layer.numStars);
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const sizes = new Float32Array(n);

  const bulge = kelvinToRgb(layer.bulgeKelvin);
  const arm = kelvinToRgb(layer.armKelvin);
  const armCount = Math.max(1, layer.arms);
  const armOffset = (Math.PI * 2) / armCount;
  const inner = layer.bulgeSize * 0.4;
  // deterministic per-seed phases for the arm kink waves
  const kinkPhase = rng.unit() * Math.PI * 2;
  const kinkPhase2 = rng.unit() * Math.PI * 2;

  // three populations (JWST look): central bulge, perturbed arms, and a
  // faint inter-arm web that fills the blank space between arms
  const nBulge = Math.floor(n * 0.15);
  const nWeb = Math.floor(n * 0.22);

  const write = (i: number, x: number, y: number, z: number, r: number, g: number, b: number, size: number) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 4] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = 1;
    sizes[i] = size;
  };

  for (let i = 0; i < n; i++) {
    if (i < nBulge) {
      // bulge: OVOID with density rising steeply toward the center —
      // sample a random 3D direction, then a strongly center-weighted
      // radius, and squash into a triaxial ellipsoid (1 : 0.82 : 0.5)
      const u = rng.unit();
      const rad = inner * 1.9 * Math.pow(u, 1.5); // p>1 => dense core
      const phi = rng.unit() * Math.PI * 2;
      const cz = rng.unit() * 2 - 1;
      const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
      const bx = rad * sz * Math.cos(phi);
      const by = rad * sz * Math.sin(phi) * 0.82;
      const bz = rad * cz * 0.5;
      // brightness also rises toward the center
      const bright = (0.55 + 1.1 * (1 - Math.pow(u, 0.7))) * (0.6 + 0.5 * rng.unit());
      write(i, bx, by, bz,
        bulge.r * bright, bulge.g * bright, bulge.b * bright,
        layer.starSize * (0.45 + rng.unit() * 0.75));
      continue;
    }

    if (i < nBulge + nWeb) {
      // inter-arm web: faint filamentary fill between the arms, weighted
      // toward the mid-arm phase so it reads as connective tissue
      const tW = 0.2 + 0.8 * Math.sqrt(rng.unit());
      const thW = rng.unit() * Math.PI * 2;
      const phase = thW - tW * layer.windings * Math.PI * 2;
      // distance to the nearest arm in phase space (0 = on-arm, 1 = mid-gap)
      let dMin = Math.PI;
      for (let a = 0; a < armCount; a++) {
        const d = Math.abs(((phase - a * armOffset) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        dMin = Math.min(dMin, d);
      }
      const gap = dMin / (armOffset / 2); // 0 on-arm .. ~1 mid-gap
      // filament strands: brightness peaks in shallow bands across the gap
      const strand = 0.5 + 0.5 * Math.sin(gap * 6.5 + tW * 9 + kinkPhase2);
      const bright = 0.1 + 0.24 * strand * (1 - tW * 0.5);
      const radius = tW * (1 + (rng.unit() - 0.5) * 0.12);
      const z = (rng.unit() + rng.unit() - 1) * layer.thickness * (1.3 - tW * 0.5);
      // dusty blue-grey between the arms
      const mixw = 0.65;
      write(i, radius * Math.cos(thW), radius * Math.sin(thW), z,
        (bulge.r + mixw * (arm.r - bulge.r)) * bright * 0.9,
        (bulge.g + mixw * (arm.g - bulge.g)) * bright * 0.95,
        (bulge.b + mixw * (arm.b - bulge.b)) * bright * 1.05,
        layer.starSize * (0.4 + rng.unit() * 0.5));
      continue;
    }

    // arm stars: log-spiral with kink waves + clumping so arms aren't
    // clean mathematical curves (JWST arms are ragged and knotted)
    const armIndex = i % armCount;
    const t = Math.sqrt(rng.unit()); // denser toward center
    const kink =
      0.30 * layer.spread * Math.sin(t * 9.2 + armIndex * 2.1 + kinkPhase) +
      0.16 * layer.spread * Math.sin(t * 23.7 + kinkPhase2 + armIndex);
    const theta = t * layer.windings * Math.PI * 2 + armIndex * armOffset
      + kink
      + (rng.unit() - 0.5) * layer.spread * (2.2 - t);
    // radial clumping: knots along the arm every ~1/9 of its length
    const knot = 0.5 + 0.5 * Math.sin(t * 56 + armIndex * 4 + kinkPhase);
    const radius = (inner + t * (1 - inner))
      * (1 + (rng.unit() - 0.5) * layer.spread * 0.5)
      * (1 + 0.015 * Math.sin(t * 31 + kinkPhase2));

    // thin disc; thicker toward the bulge
    const zSpread = layer.thickness * (1.6 - t);
    const z = (rng.unit() + rng.unit() - 1) * zSpread; // triangular ~gaussian-ish

    const mix = Math.min(1, t * 1.3);
    const brightness = (0.35 + 0.65 * (1 - t * 0.6)) * (0.4 + rng.unit() * 0.45 + 0.3 * knot);
    write(i, radius * Math.cos(theta), radius * Math.sin(theta), z,
      (bulge.r + mix * (arm.r - bulge.r)) * brightness,
      (bulge.g + mix * (arm.g - bulge.g)) * brightness,
      (bulge.b + mix * (arm.b - bulge.b)) * brightness,
      layer.starSize * (0.6 + rng.unit() * 0.8) * (0.85 + 0.3 * knot));
  }

  // ---- non-star particle populations (separate RNG stream) ----
  const blobRng = new MsvcRng((layer.seed + 0x9eb) >>> 0);
  const makeBlobs = (count: number): GalaxyBlobs => ({
    positions: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    colors: new Float32Array(count * 4),
    count,
  });

  // bright HII / reflection nebulas at arm knots
  let nebulae: GalaxyBlobs | undefined;
  const nNeb = Math.round((layer.nebulae ?? 0) * 46);
  if (nNeb > 0) {
    nebulae = makeBlobs(nNeb);
    const HUES = [
      { r: 1.0, g: 0.38, b: 0.32 },  // Halpha pink-red
      { r: 1.0, g: 0.62, b: 0.55 },  // pink-white
      { r: 0.38, g: 0.85, b: 0.75 }, // OIII teal
      { r: 0.55, g: 0.68, b: 1.0 },  // reflection blue
    ];
    for (let i = 0; i < nNeb; i++) {
      const armIndex = i % armCount;
      // favor knot maxima along the arm
      let t = 0.25 + 0.7 * blobRng.unit();
      if (0.5 + 0.5 * Math.sin(t * 56 + armIndex * 4 + kinkPhase) < 0.55) {
        t = 0.25 + 0.7 * blobRng.unit();
      }
      const kink =
        0.30 * layer.spread * Math.sin(t * 9.2 + armIndex * 2.1 + kinkPhase) +
        0.16 * layer.spread * Math.sin(t * 23.7 + kinkPhase2 + armIndex);
      const th = t * layer.windings * Math.PI * 2 + armIndex * armOffset + kink
        + (blobRng.unit() - 0.5) * 0.12;
      const rad = (inner + t * (1 - inner)) * (1 + (blobRng.unit() - 0.5) * 0.08);
      nebulae.positions[i * 3] = rad * Math.cos(th);
      nebulae.positions[i * 3 + 1] = rad * Math.sin(th);
      nebulae.positions[i * 3 + 2] = (blobRng.unit() + blobRng.unit() - 1) * layer.thickness * 0.7;
      nebulae.sizes[i] = 0.05 + blobRng.unit() * 0.09;
      const hue = HUES[blobRng.rand() % HUES.length];
      const inten = (0.09 + 0.13 * blobRng.unit()) * (layer.nebulae ?? 0);
      nebulae.colors[i * 4] = hue.r * inten;
      nebulae.colors[i * 4 + 1] = hue.g * inten;
      nebulae.colors[i * 4 + 2] = hue.b * inten;
      nebulae.colors[i * 4 + 3] = 1;
    }
  }

  // dark dust clouds hugging the inner arm edges
  let dust: GalaxyBlobs | undefined;
  const nDust = Math.round((layer.dust ?? 0) * 72);
  if (nDust > 0) {
    dust = makeBlobs(nDust);
    for (let i = 0; i < nDust; i++) {
      const armIndex = i % armCount;
      const t = 0.22 + 0.72 * blobRng.unit();
      const kink =
        0.30 * layer.spread * Math.sin(t * 9.2 + armIndex * 2.1 + kinkPhase) +
        0.16 * layer.spread * Math.sin(t * 23.7 + kinkPhase2 + armIndex);
      const th = t * layer.windings * Math.PI * 2 + armIndex * armOffset + kink
        - 0.14 + (blobRng.unit() - 0.5) * 0.1;
      const rad = (inner + t * (1 - inner)) * 0.95 * (1 + (blobRng.unit() - 0.5) * 0.08);
      dust.positions[i * 3] = rad * Math.cos(th);
      dust.positions[i * 3 + 1] = rad * Math.sin(th);
      dust.positions[i * 3 + 2] = (blobRng.unit() + blobRng.unit() - 1) * layer.thickness * 0.5;
      dust.sizes[i] = 0.05 + blobRng.unit() * 0.1;
      // alpha = darkening strength (blend zero / 1-src_alpha at render)
      dust.colors[i * 4] = 1;
      dust.colors[i * 4 + 1] = 1;
      dust.colors[i * 4 + 2] = 1;
      dust.colors[i * 4 + 3] = (0.3 + 0.45 * blobRng.unit()) * (layer.dust ?? 0);
    }
  }

  return { positions, colors, sizes, count: n, nebulae, dust };
}
