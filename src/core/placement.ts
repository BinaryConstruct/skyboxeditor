/**
 * Shared placement logic for points/billboards layers, ported from
 * SpacescapeLayerPoints::buildMasked / SpacescapeLayerBillboards::buildMasked.
 *
 * The mask is a 6-face byte cubemap (rendered white-on-black by the noise
 * shader). A candidate is accepted when rand() < n^2 for the sampled noise
 * byte n — denser placement where the noise is bright.
 *
 * Direction convention: the original mapped (u,v,face) through Ogre's
 * rotatePoint; we map through the WebGL cubemap convention instead so that
 * placement stays aligned with the *same* cubemap the sky preview displays.
 * The rand() consumption order is identical, so seeds behave the same way.
 */
import { MsvcRng } from './rng';

/** 6-face RGBA byte cubemap readback (face order +X -X +Y -Y +Z -Z). */
export interface CubeMask {
  size: number;
  faces: Uint8Array[];
}

export interface Draw {
  x: number;
  y: number;
  z: number;
  /** random 0..1 "distance" used for size/color lerps */
  dist: number;
}

/** Inverse of the GL cubemap face projection: (face, s, t in [0,1]) -> dir. */
export function dirFromCubeFaceUV(face: number, s: number, t: number): [number, number, number] {
  const u = 2 * s - 1;
  const v = 2 * t - 1;
  switch (face) {
    case 0: return [1, -v, -u];  // +X
    case 1: return [-1, -v, u];  // -X
    case 2: return [u, 1, v];    // +Y
    case 3: return [u, -1, -v];  // -Y
    case 4: return [u, -v, 1];   // +Z
    default: return [-u, -v, -1]; // -Z
  }
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.sqrt(x * x + y * y + z * z);
  return [x / len, y / len, z / len];
}

/**
 * Unmasked draws: uniform sphere distribution, exactly as the original
 * build() functions (u, a, s then dist per item).
 */
export function generateDraws(seed: number, count: number): Draw[] {
  const rng = new MsvcRng(seed);
  const f = Math.fround;
  const TWO_PI = Math.fround(2 * Math.PI);
  const draws: Draw[] = [];

  for (let i = 0; i < count; i++) {
    const u = f(-1 + 2 * rng.unit());
    const a = f(TWO_PI * rng.unit());
    const s = f(Math.sqrt(1 - u * u));
    const dist = f(rng.unit());
    draws.push({ x: s * Math.cos(a), y: s * Math.sin(a), z: u, dist });
  }

  return draws;
}

/**
 * Masked draws: rejection sampling against the noise cubemap, with the
 * original's rand() consumption order (rU, rV, face, r; dist on acceptance)
 * and its 99999-attempt bail-out per item.
 *
 * Deliberate deviations from the C++:
 * - positions are normalized to the unit sphere (the original left masked
 *   *points* on the cube surface; direction — the only thing that matters for
 *   a camera-at-origin sky — is unchanged);
 * - the bail-out uses >= and resets its counter when dropping an item (the
 *   original's == check stops firing after the first bail-out, so a fully
 *   dark mask hangs it in an infinite loop).
 */
export function generateMaskedDraws(seed: number, count: number, mask: CubeMask): Draw[] {
  const rng = new MsvcRng(seed);
  const f = Math.fround;
  const { size, faces } = mask;
  const noiseScale = 1 / 255;
  const maxNumTestPoints = 99999;

  const draws: Draw[] = [];
  let remaining = count;
  let numTested = 0;
  // global budget so a fully dark mask can't freeze the UI thread
  // (deviation: the C++ has no cap and would spin ~count*99999 iterations)
  let totalBudget = Math.min(count * maxNumTestPoints, 5_000_000);

  while (remaining > 0 && totalBudget-- > 0) {
    const rU = rng.unit();
    const rV = rng.unit();

    // original: min(r * size, size) — clamped to size-1 here to avoid the
    // out-of-row read the C++ risks when rand() == RAND_MAX
    const u = Math.min(Math.trunc(rU * size), size - 1);
    const v = Math.min(Math.trunc(rV * size), size - 1);

    const face = rng.rand() % 6;

    numTested++;

    const n = faces[face][(v * size + u) * 4] * noiseScale;
    const r = rng.unit();

    if (r > n * n) {
      if (numTested >= maxNumTestPoints) {
        remaining--;
        numTested = 0;
      }
      continue;
    }

    const [dx, dy, dz] = dirFromCubeFaceUV(face, rU, rV);
    const [x, y, z] = normalize(dx, dy, dz);

    remaining--;
    numTested = 0;

    const dist = f(rng.unit());
    draws.push({ x, y, z, dist });
  }

  return draws;
}

/** float32 color-channel lerp matching Ogre's ColourValue arithmetic. */
export function lerpChannel(near: number, far: number, dist: number): number {
  const f = Math.fround;
  return f(near + f(dist * f(far - near)));
}
