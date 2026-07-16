/**
 * Point-star generation, ported from SpacescapeLayerPoints::build().
 * Deterministic per seed via the MSVC LCG. (The masked variant depends on
 * sampling the rendered noise cubemap and lands with the GPU work in Phase 2.)
 */
import { kelvinToRgb } from './blackbody';
import type { PointsLayer } from './layers';
import { generateMaskedDraws, lerpChannel, type CubeMask } from './placement';
import { MsvcRng } from './rng';

/** Ogre::Math::TWO_PI is a float constant; use its float32 value for parity. */
const TWO_PI = Math.fround(2 * Math.PI);

export interface PointStars {
  /** xyz per star, on the unit sphere. */
  positions: Float32Array;
  /** rgba per star, lerped nearColor -> farColor by random distance. */
  colors: Float32Array;
}

export function generatePoints(params: PointsLayer): PointStars {
  const { numPoints, nearColor, farColor } = params;
  const positions = new Float32Array(numPoints * 3);
  const colors = new Float32Array(numPoints * 4);

  const rng = new MsvcRng(params.seed);

  // upstream 0.5.x HDR: dist = powf(dist, hdrPower) before the lerp,
  // color *= hdrMultiplier after (no-ops at the defaults)
  const hdrPower = params.hdrPower ?? 1;
  const hdrMult = params.hdrMultiplier ?? 1;

  // C++ stores intermediates in 32-bit floats (Real/ColourValue); mirror the
  // rounding points with fround so the sequence matches bit-for-bit.
  const f = Math.fround;
  const lerpChannel = (near: number, far: number, dist: number) =>
    f(near + f(dist * f(far - near)));

  // v2 star physics — separate RNG stream so the legacy sequence above is
  // untouched; all features guarded behind their defaults
  const physicsRng = new MsvcRng((params.seed + 0x7e11) >>> 0);
  const blackbody = params.colorMode === 'blackbody';
  const band = params.bandStrength > 0;
  const bandCos = Math.cos((params.bandAngleDeg * Math.PI) / 180);
  const bandSin = Math.sin((params.bandAngleDeg * Math.PI) / 180);

  for (let i = 0; i < numPoints; i++) {
    // uniform sphere distribution, exactly as the original
    const u = f(-1 + 2 * rng.unit());
    const a = f(TWO_PI * rng.unit());
    const s = f(Math.sqrt(1 - u * u));

    let x = s * Math.cos(a);
    let y = s * Math.sin(a);
    let z = u;

    if (band) {
      // squash latitudes toward the band plane, then tilt around X
      const squashed = Math.sign(u) * Math.pow(Math.abs(u), params.bandConcentration);
      const zu = u + params.bandStrength * (squashed - u);
      const su = Math.sqrt(Math.max(0, 1 - zu * zu));
      x = su * Math.cos(a);
      y = su * Math.sin(a);
      z = zu;
      const y2 = y * bandCos - z * bandSin;
      const z2 = y * bandSin + z * bandCos;
      y = y2;
      z = z2;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // color lerped by a random "distance" (all four channels, as ColourValue)
    let dist = f(rng.unit());
    if (hdrPower !== 1) dist = f(Math.pow(dist, hdrPower));

    if (blackbody) {
      const kelvin = params.tempMin + physicsRng.unit() * (params.tempMax - params.tempMin);
      let brightness = physicsRng.unit();
      if (params.magnitudePower !== 1) brightness = Math.pow(brightness, params.magnitudePower);
      const c = kelvinToRgb(kelvin);
      colors[i * 4] = f(c.r * brightness * hdrMult);
      colors[i * 4 + 1] = f(c.g * brightness * hdrMult);
      colors[i * 4 + 2] = f(c.b * brightness * hdrMult);
      colors[i * 4 + 3] = 1;
    } else {
      colors[i * 4] = f(lerpChannel(nearColor.r, farColor.r, dist) * hdrMult);
      colors[i * 4 + 1] = f(lerpChannel(nearColor.g, farColor.g, dist) * hdrMult);
      colors[i * 4 + 2] = f(lerpChannel(nearColor.b, farColor.b, dist) * hdrMult);
      colors[i * 4 + 3] = f(lerpChannel(nearColor.a, farColor.a, dist) * hdrMult);
    }
  }

  return { positions, colors };
}

/**
 * Per-star random sizes in [pointSize, pointSizeMax], or null when the range
 * is disabled (pointSizeMax <= pointSize — the uniform legacy behavior).
 * Drawn from a SEPARATE LCG stream (derived seed) so enabling the feature
 * never perturbs the legacy position/color rand() sequence.
 */
export function generateStarSizes(params: PointsLayer, count: number): Float32Array | null {
  const min = Math.max(1, params.pointSize);
  const max = params.pointSizeMax;
  if (max <= min) return null;

  const rng = new MsvcRng((params.seed + 0x51ab3) >>> 0);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sizes[i] = min + rng.unit() * (max - min);
  }
  return sizes;
}

/**
 * Masked star generation (SpacescapeLayerPoints::buildMasked): rejection
 * sampling against a rendered noise cubemap. Falls back to the unmasked
 * variant when the layer has no mask enabled. Blackbody colors apply here
 * too; the galactic band does not (positions come from the mask).
 */
export function generatePointsMasked(params: PointsLayer, mask: CubeMask): PointStars {
  if (!params.maskEnabled) return generatePoints(params);

  const { nearColor, farColor } = params;
  const draws = generateMaskedDraws(params.seed, params.numPoints, mask);

  const f = Math.fround;
  const hdrPower = params.hdrPower ?? 1;
  const hdrMult = params.hdrMultiplier ?? 1;
  const blackbody = params.colorMode === 'blackbody';
  const physicsRng = new MsvcRng((params.seed + 0x7e11) >>> 0);

  const positions = new Float32Array(draws.length * 3);
  const colors = new Float32Array(draws.length * 4);

  draws.forEach((d, i) => {
    positions[i * 3] = d.x;
    positions[i * 3 + 1] = d.y;
    positions[i * 3 + 2] = d.z;

    if (blackbody) {
      const kelvin = params.tempMin + physicsRng.unit() * (params.tempMax - params.tempMin);
      let brightness = physicsRng.unit();
      if (params.magnitudePower !== 1) brightness = Math.pow(brightness, params.magnitudePower);
      const c = kelvinToRgb(kelvin);
      colors[i * 4] = f(c.r * brightness * hdrMult);
      colors[i * 4 + 1] = f(c.g * brightness * hdrMult);
      colors[i * 4 + 2] = f(c.b * brightness * hdrMult);
      colors[i * 4 + 3] = 1;
      return;
    }

    const dist = hdrPower !== 1 ? f(Math.pow(d.dist, hdrPower)) : d.dist;
    colors[i * 4] = f(lerpChannel(nearColor.r, farColor.r, dist) * hdrMult);
    colors[i * 4 + 1] = f(lerpChannel(nearColor.g, farColor.g, dist) * hdrMult);
    colors[i * 4 + 2] = f(lerpChannel(nearColor.b, farColor.b, dist) * hdrMult);
    colors[i * 4 + 3] = f(lerpChannel(nearColor.a, farColor.a, dist) * hdrMult);
  });

  return { positions, colors };
}
