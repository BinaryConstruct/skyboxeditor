/**
 * Nebula sprite generator: compact (quarter-moon to ~3-moon) nebula bakes
 * with embedded bright stars. Pure PCG — CPU Perlin FBM + domain warp on a
 * per-pixel canvas, deterministic per seed (MSVC LCG). Style recipes are
 * loosely modeled on real formation morphologies (see
 * docs/NEBULA-PCG-RESEARCH.md).
 */
import { kelvinToRgb } from '../core/blackbody';
import type { Rgba } from '../core/layers';
import { PerlinNoise } from '../core/perlin';
import { MsvcRng } from '../core/rng';

// 'pillars' was removed: pillars (e.g. Pillars of Creation) are a tiny inner
// structure *within* an emission nebula, not a standalone object at sprite
// scale — see docs/NEBULA-PCG-RESEARCH.md.
export type NebulaStyle = 'nursery' | 'dark-dust' | 'wisp' | 'shell';

export interface NebulaGenParams {
  seed: number;
  style: NebulaStyle;
  /** primary emission color */
  colorA: Rgba;
  /** secondary/highlight color */
  colorB: Rgba;
  scale: number;      // 1.5..8 noise frequency
  octaves: number;    // 3..7
  warp: number;       // 0..2 domain warp
  density: number;    // 0..1 overall coverage
  contrast: number;   // 0.5..3 power shaping
  dust: number;       // 0..1 dark lane strength
  brightStars: number; // 0..12 embedded stars
  starGlow: number;   // 0..1 local illumination strength
}

export const DEFAULT_NEBULA: NebulaGenParams = {
  seed: 5,
  style: 'nursery',
  colorA: { r: 0.85, g: 0.25, b: 0.2, a: 1 },  // Ha red
  colorB: { r: 0.95, g: 0.75, b: 0.45, a: 1 }, // warm core
  scale: 3,
  octaves: 5,
  warp: 0.9,
  density: 0.55,
  contrast: 1.4,
  dust: 0.4,
  brightStars: 5,
  starGlow: 0.7,
};

/** Style presets applied by the UI when the style changes. */
export const NEBULA_STYLE_DEFAULTS: Record<NebulaStyle, Partial<NebulaGenParams>> = {
  nursery: {
    colorA: { r: 0.85, g: 0.25, b: 0.2, a: 1 },
    colorB: { r: 0.95, g: 0.75, b: 0.45, a: 1 },
    warp: 0.9, density: 0.55, dust: 0.4, brightStars: 6, starGlow: 0.8, contrast: 1.4,
  },
  'dark-dust': {
    colorA: { r: 0.5, g: 0.2, b: 0.1, a: 1 },
    colorB: { r: 0.7, g: 0.5, b: 0.35, a: 1 },
    warp: 1.1, density: 0.5, dust: 1, brightStars: 2, starGlow: 0.3, contrast: 1.3,
  },
  wisp: {
    colorA: { r: 0.25, g: 0.45, b: 0.9, a: 1 },
    colorB: { r: 0.7, g: 0.85, b: 1, a: 1 },
    warp: 1.4, density: 0.35, dust: 0.1, brightStars: 4, starGlow: 0.9, contrast: 1.1,
  },
  shell: {
    colorA: { r: 0.2, g: 0.7, b: 0.65, a: 1 }, // OIII teal
    colorB: { r: 0.85, g: 0.35, b: 0.25, a: 1 }, // Ha rim
    warp: 0.5, density: 0.6, dust: 0.05, brightStars: 1, starGlow: 1, contrast: 1.5,
  },
};

interface Star {
  x: number;
  y: number;
  size: number;
  kelvin: number;
}

/** Bake a nebula sprite at the given resolution. */
export function bakeNebulaGen(p: NebulaGenParams, size = 384): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  const noise = new PerlinNoise(p.seed >>> 0);
  const warpNoise = new PerlinNoise((p.seed + 0x9e37) >>> 0);
  const rng = new MsvcRng((p.seed + 0x51de) >>> 0);

  // embedded bright stars: placed first so the density pass can use their
  // positions for local illumination
  const stars: Star[] = [];
  for (let i = 0; i < p.brightStars; i++) {
    stars.push({
      x: 0.5 + (rng.unit() - 0.5) * 0.6,
      y: 0.5 + (rng.unit() - 0.5) * 0.6,
      size: 2 + rng.unit() * 4,
      kelvin: 6000 + rng.unit() * 14000, // young hot cluster
    });
  }
  // a planetary shell's progenitor white dwarf sits dead center
  if (p.style === 'shell' && stars.length > 0) {
    stars[0].x = 0.5;
    stars[0].y = 0.5;
    stars[0].kelvin = 25000;
  }
  const img = ctx.createImageData(size, size);
  const contrastInv = 1 / Math.max(0.01, p.contrast);

  const fbm = (x: number, y: number, oct: number, n: PerlinNoise) =>
    n.fbm(x, y, 0.37, oct, 0.5, 2.0) * 0.5 + 0.5;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // normalized coords, center origin
      const u = px / size;
      const v = py / size;
      const cx = u - 0.5;
      const cy = v - 0.5;
      const r = Math.hypot(cx, cy) * 2; // 0 center, 1 at edge

      // domain warp — chained ("warp of a warp") at high strengths, which
      // reads noticeably more organic than a single level (iq/AltPsyche)
      let wx = u * p.scale;
      let wy = v * p.scale;
      if (p.warp > 0) {
        let qx = u * p.scale * 0.8;
        let qy = v * p.scale * 0.8;
        if (p.warp > 0.8) {
          const q2x = qx + (fbm(qx * 0.5 + 3.3, qy * 0.5, 2, warpNoise) - 0.5) * p.warp;
          const q2y = qy + (fbm(qx * 0.5, qy * 0.5 + 9.9, 2, warpNoise) - 0.5) * p.warp;
          qx = q2x;
          qy = q2y;
        }
        wx += p.warp * (fbm(qx + 13.7, qy, 3, warpNoise) - 0.5) * 2;
        wy += p.warp * (fbm(qx, qy + 71.3, 3, warpNoise) - 0.5) * 2;
      }

      let d = fbm(wx, wy, p.octaves, noise); // 0..1 density
      const dRaw = d;

      // irregular boundary: warp the radial distance with low-freq noise so
      // envelopes don't read as circles
      const edgeNoise = fbm(cx * 2.2 + 7.7, cy * 2.2 + 3.1, 3, warpNoise);
      const ri = r * (0.72 + 0.72 * edgeNoise);

      // style envelopes
      let rim = 0; // ionization-rim boost
      switch (p.style) {
        case 'nursery':
          d *= Math.max(0, 1 - ri * ri * 1.15);
          break;
        case 'wisp':
          d *= Math.max(0, 1 - ri * 1.05) * (0.6 + 0.4 * fbm(wx * 0.5, wy * 0.5, 2, warpNoise));
          break;
        case 'dark-dust':
          d *= Math.max(0, 1 - ri * ri * 1.2);
          break;
        case 'shell': {
          // ring density peaked at radius 0.55
          const shell = Math.exp(-Math.pow((r - 0.55) / 0.16, 2));
          d = d * 0.35 + shell * (0.5 + d * 0.6);
          rim = Math.exp(-Math.pow((r - 0.66) / 0.07, 2)) * 0.8;
          d *= Math.max(0, 1 - Math.pow(Math.max(0, r - 0.75) * 4, 2));
          break;
        }
      }

      d *= p.density * 1.6;
      d = Math.min(1, Math.max(0, d));
      d = Math.pow(d, contrastInv);

      // local illumination from embedded stars
      let glow = 0;
      if (p.starGlow > 0) {
        for (const s of stars) {
          const dist = Math.hypot(u - s.x, v - s.y);
          glow += Math.exp(-dist * dist * 55) * p.starGlow;
        }
        glow = Math.min(1, glow);
      }

      // directional ionization rim: where the density surface faces the
      // primary illuminating star, boost brightness (gradient-dot-toStar —
      // this is what makes a blob read as lit from one side, not flat)
      if (p.starGlow > 0 && stars.length > 0 && p.style !== 'shell') {
        const eps = 0.35;
        const gx = fbm(wx + eps, wy, p.octaves, noise) - dRaw;
        const gy = fbm(wx, wy + eps, p.octaves, noise) - dRaw;
        const gLen = Math.hypot(gx, gy) + 1e-6;
        let sx = stars[0].x - u;
        let sy = stars[0].y - v;
        const sLen = Math.hypot(sx, sy) + 1e-6;
        sx /= sLen;
        sy /= sLen;
        // -grad points out of the dense region; rim where it faces the star
        const facing = Math.max(0, (-gx * sx - gy * sy) / gLen);
        rim += Math.pow(facing, 2.5) * d * (1 - d) * 3.2 * p.starGlow * 0.55;
      }

      // dust: high-frequency ridged darkening, strongest in dense regions
      let dark = 0;
      if (p.dust > 0) {
        const dn = Math.abs(noise.fbm(wx * 2.1 + 41.7, wy * 2.1, 0.37, 4, 0.55, 2.2));
        dark = Math.max(0, 1 - dn * 3.2) * p.dust * Math.min(1, d * 1.8);
      }

      // decorrelate hue from density with a second noise field — the top
      // fix for the "uniform fog" look (color structure != brightness
      // structure in real nebulas)
      const hueField = fbm(wx * 0.7 + 91.2, wy * 0.7 + 45.6, 2, warpNoise);
      const mix = Math.min(1, d * 0.35 + hueField * 0.4 + glow * 0.7 + rim);
      let cr = p.colorA.r + mix * (p.colorB.r - p.colorA.r);
      let cg = p.colorA.g + mix * (p.colorB.g - p.colorA.g);
      let cb = p.colorA.b + mix * (p.colorB.b - p.colorA.b);

      const lum = d * (0.55 + glow * 0.85 + rim) * (1 - dark * 0.92);
      cr *= lum;
      cg *= lum;
      cb *= lum;

      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, cr * 255);
      img.data[o + 1] = Math.min(255, cg * 255);
      img.data[o + 2] = Math.min(255, cb * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // draw the embedded stars on top (additive)
  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    const c = kelvinToRgb(s.kelvin);
    const x = s.x * size;
    const y = s.y * size;
    const radius = s.size * (size / 256);
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 6);
    g.addColorStop(0, `rgba(255,255,255,1)`);
    g.addColorStop(0.12, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.8)`);
    g.addColorStop(0.5, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.12)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);
  }

  return canvas;
}
