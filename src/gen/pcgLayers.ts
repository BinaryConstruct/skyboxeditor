/**
 * Reusable component-layer library — Docs/Research/2026-07-16-stellar-objects-layer-guidance.md §8 adapted
 * to this codebase's canvas-2D sprite scale, registered against the pcgSpec
 * framework. A PCG object is a stack of these layers, composed deterministically
 * by composePcgObject; each layer type declares a descriptor (label + tunable
 * params) so the spec-driven editor (StarsTab PCG mode) can build a form for it.
 *
 * Each renderer draws its contribution onto a fresh transparent scratch canvas;
 * composePcgObject composites per the layer's blendMode. Emission layers put
 * brightness into RGB at alpha 1 (so 'add'/lighter sums them); the dust-lane
 * layer draws dark pixels with alpha and uses 'multiply' to actually darken the
 * layers beneath it inside the bake.
 *
 * Determinism: every layer derives noise/point streams from
 * (object.seed XOR layer.seed) — adding a layer never reshuffles another.
 */
import { kelvinToRgb } from '../core/blackbody';
import type { Rgba } from '../core/layers';
import { PerlinNoise } from '../core/perlin';
import { MsvcRng } from '../core/rng';
import {
  registerPcgLayerType, type PcgBlendMode, type PcgLayerSpec, type PcgObjectSpec,
} from './pcgSpec';
import { beamIntensity, dopplerFactor, geometricSeries } from './pcgMath';
import { plummerRadius } from './profiles';

// --------------------------------------------------------------- descriptors

export type PcgParamType = 'number' | 'kelvin' | 'angle' | 'enum';

export interface PcgParamDescriptor {
  id: string;
  label: string;
  type: PcgParamType;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export interface PcgLayerDescriptor {
  type: string;
  label: string;
  /** default blend mode a fresh instance of this layer gets */
  blend: PcgBlendMode;
  params: readonly PcgParamDescriptor[];
}

const descriptors = new Map<string, PcgLayerDescriptor>();

/** All registered layer descriptors, sorted by label — drives the editor. */
export function pcgLayerDescriptors(): PcgLayerDescriptor[] {
  return [...descriptors.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function pcgLayerDescriptor(type: string): PcgLayerDescriptor | undefined {
  return descriptors.get(type);
}

/** Build a default params object for a layer type from its descriptor. */
export function defaultLayerParams(type: string): Record<string, unknown> {
  const d = descriptors.get(type);
  const out: Record<string, unknown> = {};
  if (d) for (const p of d.params) out[p.id] = p.default;
  return out;
}

// --------------------------------------------------------------- param access

const num = (layer: PcgLayerSpec, id: string, fallback: number): number => {
  const v = layer.params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (layer: PcgLayerSpec, id: string, fallback: string): string => {
  const v = layer.params[id];
  return typeof v === 'string' ? v : fallback;
};
/** Independent-but-deterministic stream seed for a layer. */
const streamSeed = (object: PcgObjectSpec, layer: PcgLayerSpec, salt = 0): number =>
  ((object.seed ^ layer.seed ^ (salt * 0x9e3779b1)) >>> 0);

// --------------------------------------------------------------- render utils

/** Fill an image via a per-pixel callback returning premultiplied-ish RGBA 0..1. */
function fillImage(
  ctx: CanvasRenderingContext2D, size: number,
  fn: (x: number, y: number) => [number, number, number, number] | null,
): void {
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const rgba = fn(px - c, py - c);
      if (!rgba) continue;
      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, rgba[0] * 255);
      img.data[o + 1] = Math.min(255, rgba[1] * 255);
      img.data[o + 2] = Math.min(255, rgba[2] * 255);
      img.data[o + 3] = Math.min(255, rgba[3] * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

const css = (c: Rgba, a: number) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

function addSpike(ctx: CanvasRenderingContext2D, x: number, y: number, angleDeg: number, length: number, thickness: number, intensity: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const g = ctx.createLinearGradient(-length, 0, length, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${intensity})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  for (const [t, a] of [[thickness, 0.45], [thickness * 2.2, 0.18], [thickness * 4, 0.06]] as const) {
    ctx.globalAlpha = a * intensity;
    ctx.fillRect(-length, -t / 2, length * 2, t);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ============================================================ layer renderers

/** register a renderer + its editor descriptor together. */
function register(desc: PcgLayerDescriptor, render: Parameters<typeof registerPcgLayerType>[1]): void {
  descriptors.set(desc.type, desc);
  registerPcgLayerType(desc.type, render);
}

// -- photosphere: limb-darkened disc with granulation ------------------------
register(
  {
    type: 'photosphere', label: 'Photosphere', blend: 'add',
    params: [
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 5800, min: 1500, max: 40000, step: 100 },
      { id: 'radius', label: 'Radius', type: 'number', default: 0.16, min: 0.03, max: 0.45, step: 0.005 },
      { id: 'limbDarkening', label: 'Limb dark', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
      { id: 'granulation', label: 'Granules', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01 },
      { id: 'granuleScale', label: 'Granule scale', type: 'number', default: 14, min: 2, max: 40, step: 0.5 },
    ],
  },
  (ctx, layer, object, size) => {
    const kelvin = num(layer, 'kelvin', 5800);
    const R = size * num(layer, 'radius', 0.16);
    const u = num(layer, 'limbDarkening', 0.6);
    const gran = num(layer, 'granulation', 0.35);
    const gs = num(layer, 'granuleScale', 14);
    const body = kelvinToRgb(kelvin);
    const noise = new PerlinNoise(streamSeed(object, layer, 1));
    fillImage(ctx, size, (x, y) => {
      const dx = x / R, dy = y / R;
      const r = Math.hypot(dx, dy);
      const aa = 1.5 / R;
      if (r >= 1 + aa) return null;
      const cover = r <= 1 - aa ? 1 : (1 + aa - r) / (2 * aa);
      const mu = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
      let b = 1 - u * (1 - mu);
      if (gran > 0) b *= 1 + noise.fbm(dx * gs, dy * gs, 0.7, 4, 0.55, 2.1) * 0.22 * gran;
      const wm = 0.55 * mu;
      return [(body.r + (1 - body.r) * wm) * b * cover, (body.g + (1 - body.g) * wm) * b * cover, (body.b + (1 - body.b) * wm) * b * cover, 1];
    });
  },
);

// -- corona-streamers: angular-noise radial streamers ------------------------
register(
  {
    type: 'corona-streamers', label: 'Corona streamers', blend: 'add',
    params: [
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 6000, min: 2000, max: 40000, step: 100 },
      { id: 'radius', label: 'Inner radius', type: 'number', default: 0.16, min: 0.03, max: 0.45, step: 0.005 },
      { id: 'intensity', label: 'Intensity', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
      { id: 'extent', label: 'Extent', type: 'number', default: 1.4, min: 0.3, max: 2.5, step: 0.05 },
    ],
  },
  (ctx, layer, object, size) => {
    const R = size * num(layer, 'radius', 0.16);
    const intensity = num(layer, 'intensity', 0.7);
    const extent = num(layer, 'extent', 1.4);
    const body = kelvinToRgb(num(layer, 'kelvin', 6000));
    const noise = new PerlinNoise(streamSeed(object, layer, 2));
    fillImage(ctx, size, (x, y) => {
      const r = Math.hypot(x, y) / R;
      if (r < 1) return null;
      const th = Math.atan2(y, x);
      const lobes = Math.abs(noise.fbm(Math.cos(th) * 2.3 + 7.1, Math.sin(th) * 2.3, 0.5, 4, 0.55, 2));
      const reach = extent * (0.25 + 1.5 * lobes);
      const cor = intensity * Math.exp(-(r - 1) / Math.max(0.05, reach * 0.45));
      const streak = 0.35 + 0.65 * lobes;
      const v = cor * streak;
      if (v < 0.002) return null;
      return [v * (0.6 + 0.4 * body.r), v * (0.6 + 0.4 * body.g), v * (0.62 + 0.38 * body.b), 1];
    });
  },
);

// -- prominence-arcs: Halpha loops hugging the limb --------------------------
register(
  {
    type: 'prominence-arcs', label: 'Prominence arcs', blend: 'add',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', default: 0.16, min: 0.03, max: 0.45, step: 0.005 },
      { id: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  (ctx, layer, object, size) => {
    const R = size * num(layer, 'radius', 0.16);
    const amount = num(layer, 'amount', 0.5);
    const noise = new PerlinNoise(streamSeed(object, layer, 3));
    const ha = { r: 1, g: 0.25, b: 0.18 };
    fillImage(ctx, size, (x, y) => {
      const r = Math.hypot(x, y) / R;
      if (r < 0.95 || r > 1.3) return null;
      const th = Math.atan2(y, x);
      const arc = noise.fbm(Math.cos(th) * 3.7, Math.sin(th) * 3.7 + 51.3, 0.9, 3, 0.5, 2);
      const gate = Math.max(0, arc - (1 - amount * 0.55));
      const shell = Math.exp(-Math.pow((r - 1.06) / 0.07, 2));
      const pr = gate * shell * 3.2;
      if (pr < 0.002) return null;
      return [ha.r * pr, ha.g * pr, ha.b * pr, 1];
    });
  },
);

// -- glow-halo: broad soft radial halo ---------------------------------------
register(
  {
    type: 'glow-halo', label: 'Glow halo', blend: 'add',
    params: [
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 6000, min: 1500, max: 40000, step: 100 },
      { id: 'radius', label: 'Radius', type: 'number', default: 0.16, min: 0.03, max: 0.45, step: 0.005 },
      { id: 'intensity', label: 'Intensity', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { id: 'falloff', label: 'Falloff', type: 'number', default: 2.4, min: 0.3, max: 4, step: 0.05 },
    ],
  },
  (ctx, layer, _object, size) => {
    const R = size * num(layer, 'radius', 0.16);
    const intensity = num(layer, 'intensity', 0.5);
    const falloff = num(layer, 'falloff', 2.4);
    const body = kelvinToRgb(num(layer, 'kelvin', 6000));
    fillImage(ctx, size, (x, y) => {
      const r = Math.max(1, Math.hypot(x, y) / R);
      const halo = intensity * 0.6 * Math.exp(-Math.pow((r - 1) / falloff, 1.3));
      if (halo < 0.002) return null;
      return [halo * body.r, halo * body.g, halo * body.b, 1];
    });
  },
);

// -- accretion-disc: tilted annulus + gaps + Doppler -------------------------
register(
  {
    type: 'accretion-disc', label: 'Accretion disc', blend: 'add',
    params: [
      { id: 'rInner', label: 'Inner', type: 'number', default: 0.08, min: 0.02, max: 0.3, step: 0.005 },
      { id: 'rOuter', label: 'Outer', type: 'number', default: 0.4, min: 0.1, max: 0.48, step: 0.005 },
      { id: 'tilt', label: 'Tilt°', type: 'angle', default: 70, min: 0, max: 85, step: 1 },
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 12000, min: 3000, max: 30000, step: 200 },
      { id: 'doppler', label: 'Doppler', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
      { id: 'gaps', label: 'Gaps', type: 'number', default: 0, min: 0, max: 6, step: 1 },
      { id: 'gapRatio', label: 'Gap ratio', type: 'number', default: 1.55, min: 1.35, max: 1.9, step: 0.01 },
    ],
  },
  (ctx, layer, object, size) => {
    const rIn = size * num(layer, 'rInner', 0.08);
    // paired radii from the editor may be reversed/equal — clamp, never NaN
    const rOut = Math.max(size * num(layer, 'rOuter', 0.4), rIn + 2);
    const tilt = (num(layer, 'tilt', 70) * Math.PI) / 180;
    const cosT = Math.max(0.12, Math.cos(tilt));
    const doppler = num(layer, 'doppler', 0.7);
    const kelvin = num(layer, 'kelvin', 12000);
    const hot = kelvinToRgb(kelvin);
    const cool = kelvinToRgb(Math.max(1500, kelvin * 0.4));
    const nGap = Math.round(num(layer, 'gaps', 0));
    const gapR = geometricSeries(rIn * 1.6, num(layer, 'gapRatio', 1.55), nGap);
    const rng = new MsvcRng(streamSeed(object, layer, 4));
    const gapDepth = gapR.map(() => 0.55 + 0.4 * rng.unit());
    const noise = new PerlinNoise(streamSeed(object, layer, 5));
    fillImage(ctx, size, (x, y) => {
      const yd = y / cosT;
      const rd = Math.hypot(x, yd);
      if (rd < rIn || rd > rOut) return null;
      const az = Math.atan2(yd, x);
      const t = (rd - rIn) / (rOut - rIn);
      let trans = 1;
      for (let k = 0; k < gapR.length; k++) trans *= 1 - gapDepth[k] * Math.exp(-Math.pow((rd - gapR[k]) / (0.06 * gapR[k]), 2));
      const smear = 0.8 + 0.2 * (noise.fbm(az * 8, rd * 0.05, 0.5, 3, 0.5, 2) * 0.5 + 0.5);
      const inten = (0.18 + 0.85 * Math.pow(1 - t, 2.2)) * dopplerFactor(az, doppler * 0.9) * smear * trans;
      if (inten < 0.002) return null;
      return [(hot.r + t * (cool.r - hot.r)) * inten, (hot.g + t * (cool.g - hot.g)) * inten, (hot.b + t * (cool.b - hot.b)) * inten, 1];
    });
  },
);

// -- jet-pair: two opposed knotted beams -------------------------------------
register(
  {
    type: 'jet-pair', label: 'Jet pair', blend: 'add',
    params: [
      { id: 'angle', label: 'Angle°', type: 'angle', default: 20, min: 0, max: 180, step: 1 },
      { id: 'length', label: 'Length', type: 'number', default: 0.42, min: 0.1, max: 0.48, step: 0.01 },
      { id: 'width', label: 'Width', type: 'number', default: 5, min: 1, max: 16, step: 0.5 },
      { id: 'knots', label: 'Knots', type: 'number', default: 4, min: 0, max: 6, step: 1 },
      { id: 'asymmetry', label: 'Asymmetry', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 18000, min: 4000, max: 40000, step: 200 },
      { id: 'hollow', label: 'Hollow', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    ],
  },
  (ctx, layer, object, size) => {
    const angle = (num(layer, 'angle', 20) * Math.PI) / 180;
    const L = size * num(layer, 'length', 0.42);
    const w0 = num(layer, 'width', 5);
    const wSlope = 0.06;
    const nKnot = Math.round(num(layer, 'knots', 4));
    const asym = num(layer, 'asymmetry', 0.5);
    const hollow = num(layer, 'hollow', 0);
    const col = kelvinToRgb(num(layer, 'kelvin', 18000));
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const knotL = nKnot > 0 ? geometricSeries(L * Math.pow(1.6, -(nKnot - 1)), 1.6, nKnot) : [];
    const rng = new MsvcRng(streamSeed(object, layer, 6));
    const knotAmp = knotL.map(() => 0.5 + rng.unit());
    fillImage(ctx, size, (x, y) => {
      let sum = 0;
      for (const sign of [1, -1]) {
        const la = (x * ca + y * sa) * sign;
        const da = -x * sa + y * ca;
        let inten = beamIntensity(la, da, w0, wSlope, L, hollow);
        for (let k = 0; k < knotL.length; k++) inten *= 1 + knotAmp[k] * Math.exp(-Math.pow((la - knotL[k]) / (0.05 * L + 4), 2));
        sum += inten * (sign === 1 ? 1 : 1 - asym);
      }
      if (sum < 0.002) return null;
      return [col.r * sum, col.g * sum, col.b * sum, 1];
    });
  },
);

// -- shell: nested / bipolar / limb-brightened expanding shell ---------------
register(
  {
    type: 'shell', label: 'Shell', blend: 'add',
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'limb', options: ['nested', 'bipolar', 'limb'] },
      { id: 'radius', label: 'Radius', type: 'number', default: 0.34, min: 0.1, max: 0.46, step: 0.005 },
      { id: 'thickness', label: 'Thickness', type: 'number', default: 0.06, min: 0.02, max: 0.2, step: 0.005 },
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 12000, min: 2000, max: 30000, step: 200 },
      { id: 'count', label: 'Nested count', type: 'number', default: 2, min: 1, max: 5, step: 1 },
    ],
  },
  (ctx, layer, object, size) => {
    const mode = str(layer, 'mode', 'limb');
    const Rs = size * num(layer, 'radius', 0.34);
    const th0 = size * num(layer, 'thickness', 0.06);
    const col = kelvinToRgb(num(layer, 'kelvin', 12000));
    const count = Math.round(num(layer, 'count', 2));
    const noise = new PerlinNoise(streamSeed(object, layer, 7));
    const radii = mode === 'nested' ? geometricSeries(Rs * Math.pow(0.7, count - 1), 1 / 0.7, count) : [Rs];
    fillImage(ctx, size, (x, y) => {
      const r = Math.hypot(x, y);
      const th = Math.atan2(y, x);
      const wob = 1 + 0.06 * noise.fbm(Math.cos(th) * 2.4 + 3, Math.sin(th) * 2.4, 0.5, 2, 0.5, 2);
      let v = 0;
      for (const Rr of radii) {
        const R = Rr * wob;
        if (mode === 'limb' && r < R) {
          const path = 1 / Math.sqrt(Math.max(0.02, 1 - (r / R) ** 2));
          v += Math.min(2.2, path) * Math.exp(-Math.pow((r - R) / th0, 2));
        } else if (mode === 'bipolar') {
          const lobe = Math.pow(Math.abs(Math.sin(th)), 1.5); // pinch at the waist
          v += lobe * Math.exp(-Math.pow((r - R * (0.6 + 0.5 * lobe)) / th0, 2));
        } else {
          v += Math.exp(-Math.pow((r - R) / th0, 2));
        }
      }
      v *= 0.6;
      if (v < 0.002) return null;
      return [col.r * v, col.g * v, col.b * v, 1];
    });
  },
);

// -- star-scatter: Plummer / spiral / uniform point cloud --------------------
register(
  {
    type: 'star-scatter', label: 'Star scatter', blend: 'add',
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'plummer', options: ['plummer', 'spiral', 'uniform'] },
      { id: 'count', label: 'Count', type: 'number', default: 900, min: 50, max: 4000, step: 50 },
      { id: 'radius', label: 'Radius', type: 'number', default: 0.4, min: 0.1, max: 0.48, step: 0.005 },
      { id: 'kelvin', label: 'Temp K', type: 'kelvin', default: 7000, min: 2500, max: 30000, step: 200 },
      { id: 'arms', label: 'Arms (spiral)', type: 'number', default: 2, min: 1, max: 6, step: 1 },
      { id: 'windings', label: 'Windings', type: 'number', default: 1.1, min: 0.3, max: 2, step: 0.05 },
    ],
  },
  (ctx, layer, object, size) => {
    const mode = str(layer, 'mode', 'plummer');
    const count = Math.round(num(layer, 'count', 900));
    const R = size * num(layer, 'radius', 0.4);
    const baseCol = kelvinToRgb(num(layer, 'kelvin', 7000));
    const arms = Math.max(1, Math.round(num(layer, 'arms', 2)));
    const windings = num(layer, 'windings', 1.1);
    const c = size / 2;
    const rng = new MsvcRng(streamSeed(object, layer, 8));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      let x: number, y: number;
      if (mode === 'spiral') {
        const t = Math.sqrt(rng.unit());
        const arm = i % arms;
        const theta = t * windings * Math.PI * 2 + (arm * Math.PI * 2) / arms + (rng.unit() - 0.5) * 0.6;
        const rad = t * R;
        x = c + rad * Math.cos(theta);
        y = c + rad * Math.sin(theta);
      } else if (mode === 'plummer') {
        const rad = Math.min(R, plummerRadius(rng.unit(), R * 0.35));
        const a = rng.unit() * Math.PI * 2;
        x = c + rad * Math.cos(a);
        y = c + rad * Math.sin(a);
      } else {
        const rad = R * Math.sqrt(rng.unit());
        const a = rng.unit() * Math.PI * 2;
        x = c + rad * Math.cos(a);
        y = c + rad * Math.sin(a);
      }
      const sz = 0.6 + rng.unit() * 1.6;
      const a = 0.25 + rng.unit() * 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.4);
      g.addColorStop(0, css(baseCol, a));
      g.addColorStop(1, css(baseCol, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - sz * 2.4, y - sz * 2.4, sz * 4.8, sz * 4.8);
    }
    ctx.restore();
  },
);

// -- dust-lane: a dark band; multiply to darken layers beneath ---------------
register(
  {
    type: 'dust-lane', label: 'Dust lane', blend: 'multiply',
    params: [
      { id: 'angle', label: 'Angle°', type: 'angle', default: 0, min: 0, max: 180, step: 1 },
      { id: 'offset', label: 'Offset', type: 'number', default: 0, min: -0.4, max: 0.4, step: 0.01 },
      { id: 'width', label: 'Width', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.005 },
      { id: 'depth', label: 'Depth', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
    ],
  },
  (ctx, layer, object, size) => {
    const angle = (num(layer, 'angle', 0) * Math.PI) / 180;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const offset = num(layer, 'offset', 0) * size;
    const width = num(layer, 'width', 0.05) * size;
    const depth = num(layer, 'depth', 0.8);
    const noise = new PerlinNoise(streamSeed(object, layer, 9));
    fillImage(ctx, size, (x, y) => {
      const perp = -x * sa + y * ca - offset;
      const wob = 1 + 0.4 * noise.fbm((x * ca + y * sa) * 0.02, 3, 0.5, 3, 0.5, 2);
      const band = Math.exp(-Math.pow(perp / (width * wob), 2));
      const a = band * depth;
      if (a < 0.004) return null;
      return [0, 0, 0, a]; // black with alpha -> multiply darkens beneath
    });
  },
);

// -- diffraction-spikes: Hubble 4 / JWST 6+2 ---------------------------------
register(
  {
    type: 'diffraction-spikes', label: 'Diffraction spikes', blend: 'add',
    params: [
      { id: 'style', label: 'Pattern', type: 'enum', default: 'hubble', options: ['hubble', 'jwst'] },
      { id: 'length', label: 'Length', type: 'number', default: 0.25, min: 0.05, max: 0.48, step: 0.01 },
      { id: 'angle', label: 'Angle°', type: 'angle', default: 45, min: 0, max: 180, step: 1 },
      { id: 'intensity', label: 'Intensity', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    ],
  },
  (ctx, layer, _object, size) => {
    const style = str(layer, 'style', 'hubble');
    const len = size * num(layer, 'length', 0.25);
    const angle = num(layer, 'angle', 45);
    const intensity = num(layer, 'intensity', 0.9);
    const c = size / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (style === 'jwst') {
      for (const a of [0, 60, 120]) addSpike(ctx, c, c, angle + a, len, 2.5, intensity);
      addSpike(ctx, c, c, angle + 90, len * 0.55, 2, intensity * 0.7);
      addSpike(ctx, c, c, angle - 90, len * 0.55, 2, intensity * 0.7);
    } else {
      addSpike(ctx, c, c, angle, len, 2.5, intensity);
      addSpike(ctx, c, c, angle + 90, len, 2.5, intensity);
    }
    ctx.restore();
  },
);

// -- lens-art: self-contained black-hole sprite art --------------------------
register(
  {
    type: 'lens-art', label: 'Lens art (black hole)', blend: 'add',
    params: [
      { id: 'horizon', label: 'Horizon', type: 'number', default: 0.1, min: 0.04, max: 0.16, step: 0.005 },
      { id: 'discInner', label: 'Disc inner', type: 'number', default: 2.2, min: 1.5, max: 4, step: 0.1 },
      { id: 'discOuter', label: 'Disc outer', type: 'number', default: 6, min: 3, max: 9, step: 0.1 },
      { id: 'tilt', label: 'Tilt°', type: 'angle', default: 75, min: 55, max: 85, step: 1 },
      { id: 'kelvin', label: 'Disc K', type: 'kelvin', default: 12000, min: 6000, max: 30000, step: 200 },
      { id: 'doppler', label: 'Doppler', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
      { id: 'photonRing', label: 'Photon ring', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  (ctx, layer, object, size) => {
    const Rh = size * num(layer, 'horizon', 0.1);
    const rIn = num(layer, 'discInner', 2.2) * Rh;
    const rOut = Math.max(num(layer, 'discOuter', 6) * Rh, rIn + 2);
    const tilt = (num(layer, 'tilt', 75) * Math.PI) / 180;
    const cosT = Math.max(0.12, Math.cos(tilt));
    const kelvin = num(layer, 'kelvin', 12000);
    const doppler = num(layer, 'doppler', 0.7);
    const photon = num(layer, 'photonRing', 1);
    const hot = kelvinToRgb(kelvin);
    const cool = kelvinToRgb(Math.max(1500, kelvin * 0.4));
    const ring = { r: 1, g: 0.85, b: 0.6 };
    const Rp = 1.16 * Rh;
    const noise = new PerlinNoise(streamSeed(object, layer, 10));
    fillImage(ctx, size, (x, y) => {
      const r = Math.hypot(x, y);
      if (r < Rh) return [0, 0, 0, 1]; // shadow (opaque black inside the bake)
      let cr = 0, cg = 0, cb = 0;
      const yd = y / cosT;
      const rd = Math.hypot(x, yd);
      if (rd >= rIn && rd <= rOut) {
        const az = Math.atan2(yd, x);
        const t = (rd - rIn) / (rOut - rIn);
        const smear = 0.8 + 0.2 * (noise.fbm(az * 8, rd * 0.05, 0.5, 3, 0.5, 2) * 0.5 + 0.5);
        const inten = (0.18 + 0.85 * Math.pow(1 - t, 2.2)) * dopplerFactor(az, doppler * 0.9) * smear;
        cr += (hot.r + t * (cool.r - hot.r)) * inten;
        cg += (hot.g + t * (cool.g - hot.g)) * inten;
        cb += (hot.b + t * (cool.b - hot.b)) * inten;
      }
      if (photon > 0) {
        const rr = Math.exp(-Math.pow((r - Rp) / (0.09 * Rh), 2)) * photon * 1.1;
        cr += ring.r * rr; cg += ring.g * rr; cb += ring.b * rr;
      }
      if (cr + cg + cb < 0.002) return null;
      return [cr, cg, cb, 1];
    });
  },
);

// ---------------------------------------------------------------- side effect

/** Number of registered component-layer types (spot-checked in tests). */
export const PCG_LAYER_COUNT = 11;
