/**
 * Billboard (flare) placement, ported from SpacescapeLayerBillboards
 * build()/buildMasked(). Positions are on the unit sphere; sizes are world
 * units relative to that sphere; billboards face the origin.
 */
import type { BillboardsLayer, Rgba } from './layers';
import { generateDraws, generateMaskedDraws, lerpChannel, type CubeMask, type Draw } from './placement';
import { MsvcRng } from './rng';

export interface Billboards {
  /** xyz per billboard, on the unit sphere */
  positions: Float32Array;
  /** world-size per billboard (relative to unit sphere radius) */
  sizes: Float32Array;
  /** rgba per billboard */
  colors: Float32Array;
  count: number;
  /** index into the layer's textureMix per billboard (mixed-type fields) */
  texIndex?: Uint16Array;
}

/** Subset of a Billboards batch — used to split a mixed-texture layer. */
export function filterBillboards(src: Billboards, keep: (i: number) => boolean): Billboards {
  const idx: number[] = [];
  for (let i = 0; i < src.count; i++) if (keep(i)) idx.push(i);
  const positions = new Float32Array(idx.length * 3);
  const sizes = new Float32Array(idx.length);
  const colors = new Float32Array(idx.length * 4);
  idx.forEach((s, d) => {
    positions.set(src.positions.subarray(s * 3, s * 3 + 3), d * 3);
    sizes[d] = src.sizes[s];
    colors.set(src.colors.subarray(s * 4, s * 4 + 4), d * 4);
  });
  return { positions, sizes, colors, count: idx.length };
}

function fromDraws(layer: BillboardsLayer, draws: Draw[]): Billboards {
  const f = Math.fround;
  const { minSize, maxSize, nearColor, farColor } = layer;
  const sizeSpan = f(maxSize - minSize);

  // upstream 0.5.x HDR: dist = powf(dist, hdrPower) before size/color,
  // color *= hdrMultiplier after (no-ops at the defaults)
  const hdrPower = layer.hdrPower ?? 1;
  const hdrMult = layer.hdrMultiplier ?? 1;

  // weighted hue populations: separate RNG stream so the legacy placement
  // sequence is untouched when the palette is absent
  const palette = layer.huePalette && layer.huePalette.length >= 2 ? layer.huePalette : null;
  const paletteRng = palette ? new MsvcRng((layer.seed + 0xb1b0) >>> 0) : null;
  const totalWeight = palette ? palette.reduce((s, p) => s + Math.max(0, p.t), 0) : 0;
  const pickHue = (): Rgba => {
    let roll = paletteRng!.unit() * totalWeight;
    for (const p of palette!) {
      roll -= Math.max(0, p.t);
      if (roll <= 0) return p.color;
    }
    return palette![palette!.length - 1].color;
  };

  const positions = new Float32Array(draws.length * 3);
  const sizes = new Float32Array(draws.length);
  const colors = new Float32Array(draws.length * 4);

  draws.forEach((d, i) => {
    positions[i * 3] = d.x;
    positions[i * 3 + 1] = d.y;
    positions[i * 3 + 2] = d.z;

    const dist = hdrPower !== 1 ? f(Math.pow(d.dist, hdrPower)) : d.dist;

    // closer (smaller dist) = larger, as the original
    sizes[i] = f(minSize + sizeSpan * (1 - dist));

    if (palette) {
      const hue = pickHue();
      colors[i * 4] = f(hue.r * hdrMult);
      colors[i * 4 + 1] = f(hue.g * hdrMult);
      colors[i * 4 + 2] = f(hue.b * hdrMult);
      colors[i * 4 + 3] = f(hue.a * hdrMult);
    } else {
      colors[i * 4] = f(lerpChannel(nearColor.r, farColor.r, dist) * hdrMult);
      colors[i * 4 + 1] = f(lerpChannel(nearColor.g, farColor.g, dist) * hdrMult);
      colors[i * 4 + 2] = f(lerpChannel(nearColor.b, farColor.b, dist) * hdrMult);
      colors[i * 4 + 3] = f(lerpChannel(nearColor.a, farColor.a, dist) * hdrMult);
    }
  });

  return { positions, sizes, colors, count: draws.length };
}

export function generateBillboards(layer: BillboardsLayer, mask?: CubeMask): Billboards {
  const draws = mask && layer.maskEnabled
    ? generateMaskedDraws(layer.seed, layer.numBillboards, mask)
    : generateDraws(layer.seed, layer.numBillboards);
  const out = fromDraws(layer, draws);

  // mixed texture set: each billboard picks from textureMix on a separate
  // seeded stream, so enabling the mix never disturbs placement/color draws
  const mix = layer.textureMix;
  if (mix && mix.length >= 2) {
    const rng = new MsvcRng((layer.seed + 0x7e15) >>> 0);
    const texIndex = new Uint16Array(out.count);
    for (let i = 0; i < out.count; i++) texIndex[i] = rng.rand() % mix.length;
    out.texIndex = texIndex;
  }
  return out;
}
