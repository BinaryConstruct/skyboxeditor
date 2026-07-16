/**
 * Perlin noise core, ported exactly from SpacescapeLayer.cpp
 * (Spacescape 0.5.1, MIT, Alex Peterson). Behavioral quirks of the original
 * are preserved deliberately — parity with legacy saves beats correctness of
 * the reference algorithm. See notes on `fade` and `fastFloor`.
 */
import { MsvcRng } from './rng';

/** Ken Perlin's 12 gradients padded to 16, exactly as the original's grad3[]. */
const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];

/**
 * Original FASTFLOOR macro: truncation-based, so for negative *integer* inputs
 * it returns x-1 (e.g. -2.0 -> -3), unlike Math.floor. Preserved.
 */
function fastFloor(x: number): number {
  return x > 0 ? Math.trunc(x) : Math.trunc(x) - 1;
}

/**
 * Original fade macro: `t*t*t*t*(t*(t*6-15)+10)` — note FOUR t factors, i.e.
 * t^4(6t^2-15t+10), where Perlin's reference uses t^3(...). Preserved: the
 * legacy CPU noise (and its snapshot values) depend on it.
 */
function fade(t: number): number {
  return t * t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

/** Gradient-dot-residual for improved Perlin noise (exact port). */
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

export class PerlinNoise {
  /** Permutation table, 256 values duplicated to 512 (as the original). */
  readonly perm = new Uint8Array(512);

  constructor(seed = 0) {
    this.init(seed);
  }

  /**
   * SpacescapeLayer::initNoise — identity table shuffled by MSVC rand()%256
   * swaps, then duplicated.
   */
  init(seed: number): void {
    const perm = this.perm;
    for (let i = 0; i < 256; i++) perm[i] = i;

    const rng = new MsvcRng(seed);
    for (let i = 0; i < 256; i++) {
      const swapIndex = rng.rand() % 256;
      const oldVal = perm[i];
      perm[i] = perm[swapIndex];
      perm[swapIndex] = oldVal;
    }

    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  }

  /** Improved Perlin noise (3d), roughly in [-1, 1]. Exact port. */
  noise(x: number, y: number, z: number): number {
    const perm = this.perm;
    const X = fastFloor(x) & 255;
    const Y = fastFloor(y) & 255;
    const Z = fastFloor(z) & 255;
    x -= fastFloor(x);
    y -= fastFloor(y);
    z -= fastFloor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    return lerp(w,
      lerp(v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
      lerp(v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));
  }

  /** FBM noise, normalized to [-1, 1] by the amplitude sum. */
  fbm(x: number, y: number, z: number, octaves = 1, gain = 0.5, lacunarity = 2.0): number {
    let noiseSum = 0;
    let amplitude = 1;
    let amplitudeSum = 0;

    for (let i = 0; i < octaves; i++) {
      noiseSum += this.noise(x, y, z) * amplitude;
      amplitudeSum += amplitude;
      amplitude *= gain;
      x *= lacunarity;
      y *= lacunarity;
      z *= lacunarity;
    }

    return noiseSum / amplitudeSum;
  }

  /** Ridged FBM noise (multiplicative feedback via `prev`, as the original). */
  ridgedFbm(
    x: number, y: number, z: number,
    octaves = 1, gain = 0.5, lacunarity = 2.0, offset = 1.0,
  ): number {
    let noiseSum = 0;
    let amplitude = 1;
    let amplitudeSum = 0;
    let prev = 1;

    for (let i = 0; i < octaves; i++) {
      const n = ridge(this.noise(x, y, z), offset);
      noiseSum += n * amplitude * prev;
      prev = n;
      amplitudeSum += amplitude;
      amplitude *= gain;
      x *= lacunarity;
      y *= lacunarity;
      z *= lacunarity;
    }

    return noiseSum / amplitudeSum;
  }

  /**
   * 256x256 RGBA permutation lookup texture for the GPU noise shader, with
   * X/Y pre-added exactly as SpacescapeLayer::renderNoiseToTexture (Z is
   * added in the shader).
   */
  buildPermTexture(): Uint8Array {
    const perm = this.perm;
    const out = new Uint8Array(256 * 256 * 4);
    for (let Y = 0; Y < 256; Y++) {
      for (let X = 0; X < 256; X++) {
        const o = (Y * 256 + X) * 4;
        const A = perm[X];
        out[o] = perm[A + Y];
        out[o + 1] = perm[A + Y + 1];
        const B = perm[X + 1];
        out[o + 2] = perm[B + Y];
        out[o + 3] = perm[B + Y + 1];
      }
    }
    return out;
  }

  /** 256x1 RGB gradient lookup texture (normalized grad3, packed to bytes). */
  buildGradTexture(): Uint8Array {
    const out = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const [gx, gy, gz] = GRAD3[this.perm[i] & 15];
      const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
      out[i * 3] = Math.floor((gx / len * 0.5 + 0.5) * 255);
      out[i * 3 + 1] = Math.floor((gy / len * 0.5 + 0.5) * 255);
      out[i * 3 + 2] = Math.floor((gz / len * 0.5 + 0.5) * 255);
    }
    return out;
  }
}

/** Ridge function for ridged FBM: (offset - |n|)^2. */
export function ridge(noiseVal: number, offset: number): number {
  const v = offset - Math.abs(noiseVal);
  return v * v;
}
