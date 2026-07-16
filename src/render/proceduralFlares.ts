/**
 * Procedural flare textures, baked once to offscreen canvases as a pre-step
 * before layers reference them (texture ids "proc:<style>"). All bakes are
 * WHITE on black so per-billboard vertex colors provide the hue — one
 * texture serves every hue population.
 */
import * as THREE from 'three';
// runtime-only use — the module cycle with generators.ts (which imports our
// primitives) is benign because neither side touches the other at eval time
import { DEFAULT_GALAXY, bakeGalaxyGen } from '../gen/generators';
import { ditherCanvas, windowSpriteEdges } from '../gen/genCommon';

export const PROCEDURAL_FLARES = [
  'proc:point',
  'proc:halo',
  'proc:hubble',
  'proc:jwst',
  'proc:galaxy-smudge',
  'proc:galaxy-spiral',
  'proc:galaxy-elliptical',
  'proc:galaxy-edgeon',
  'proc:galaxy-globular',
  'proc:dust-blob',
] as const;

/**
 * Typed mini-galaxy textures from the morphology bakers. Unlike the white
 * primitive flares these carry their own color; the layer's per-billboard
 * tint (e.g. the redshift near/far lerp) multiplies over it.
 */
const GALAXY_TEXTURES: Record<string, () => HTMLCanvasElement> = {
  'proc:galaxy-spiral': () =>
    bakeGalaxyGen({ ...DEFAULT_GALAXY, morphology: 'spiral', seed: 5, particles: 2500, tiltDeg: 30 }),
  'proc:galaxy-elliptical': () =>
    bakeGalaxyGen({ ...DEFAULT_GALAXY, morphology: 'elliptical', seed: 11 }),
  'proc:galaxy-edgeon': () =>
    bakeGalaxyGen({ ...DEFAULT_GALAXY, morphology: 'edge-on', seed: 7 }),
  'proc:galaxy-globular': () =>
    bakeGalaxyGen({ ...DEFAULT_GALAXY, morphology: 'globular', seed: 3, stars: 900 }),
};

const SIZE = 256;

export function gaussianCore(ctx: CanvasRenderingContext2D, radius: number, intensity = 1): void {
  const c = SIZE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, radius);
  g.addColorStop(0, `rgba(255,255,255,${intensity})`);
  g.addColorStop(0.25, `rgba(255,255,255,${0.55 * intensity})`);
  g.addColorStop(0.6, `rgba(255,255,255,${0.12 * intensity})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

export function spike(ctx: CanvasRenderingContext2D, angleDeg: number, length: number, thickness: number, intensity: number): void {
  const c = SIZE / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const g = ctx.createLinearGradient(-length, 0, length, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${intensity})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  // vertical falloff via three stacked strips
  for (const [t, a] of [[thickness, 0.45], [thickness * 2.2, 0.18], [thickness * 4, 0.06]] as const) {
    ctx.globalAlpha = a * intensity;
    ctx.fillRect(-length, -t / 2, length * 2, t);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function ring(ctx: CanvasRenderingContext2D, radius: number, width: number, intensity: number): void {
  const c = SIZE / 2;
  const g = ctx.createRadialGradient(c, c, Math.max(0, radius - width), c, c, radius + width);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${intensity})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

export function bakeProceduralFlare(style: string): THREE.Texture | null {
  const canvas = bakeFlareCanvas(style);
  if (!canvas) return null;
  ditherCanvas(canvas); // gradients band in 8-bit when quads magnify them
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false; // same policy as file flares (mip border bleed)
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Canvas-only bake, also used for UI thumbnails. */
export function bakeFlareCanvas(style: string): HTMLCanvasElement | null {
  const galaxyBake = GALAXY_TEXTURES[style];
  if (galaxyBake) return windowSpriteEdges(galaxyBake());

  // dark dust cloud: TRANSPARENT background with an alpha-gaussian dark
  // blob — pair with blend zero / one_minus_src_alpha so the quad darkens
  // whatever is behind it (dst * (1 - srcAlpha)); edges are neutral
  if (style === 'proc:dust-blob') {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const c = SIZE / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, SIZE * 0.48);
    g.addColorStop(0, 'rgba(18,11,8,0.85)');
    g.addColorStop(0.4, 'rgba(18,11,8,0.5)');
    g.addColorStop(0.75, 'rgba(18,11,8,0.16)');
    g.addColorStop(1, 'rgba(18,11,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    return canvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = 'lighter';

  switch (style) {
    case 'proc:point':
      gaussianCore(ctx, 70);
      break;
    case 'proc:halo':
      gaussianCore(ctx, 55);
      ring(ctx, 88, 14, 0.28);
      break;
    case 'proc:hubble':
      // classic 4-spike diffraction cross at 45°
      gaussianCore(ctx, 46);
      spike(ctx, 45, 118, 3, 1);
      spike(ctx, 135, 118, 3, 1);
      break;
    case 'proc:jwst':
      // 6 hex-mirror spikes + 2 short horizontal strut spikes
      gaussianCore(ctx, 42);
      for (const a of [0, 60, 120]) spike(ctx, a + 90, 112, 3, 0.95);
      spike(ctx, 0, 66, 2.5, 0.7);
      break;
    case 'proc:galaxy-smudge': {
      // distant galaxy: elongated soft ellipse (2.2:1) with a brighter core.
      // The halo uses an exponential multi-stop tail — a plain two-stop
      // gradient ends in a visible Mach-band ellipse ("harsh falloff").
      const c = SIZE / 2;
      const soft = (radius: number, peak: number) => {
        const g = ctx.createRadialGradient(c, c, 0, c, c, radius);
        // ~exp(-3.2 t) tail, reaching true zero only at the very edge
        const stops: Array<[number, number]> = [
          [0, 1], [0.12, 0.68], [0.25, 0.44], [0.4, 0.26],
          [0.55, 0.14], [0.7, 0.07], [0.84, 0.028], [0.94, 0.009], [1, 0],
        ];
        for (const [t, a] of stops) g.addColorStop(t, `rgba(255,255,255,${a * peak})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SIZE, SIZE);
      };
      ctx.save();
      ctx.translate(c, c);
      ctx.scale(1, 1 / 2.2);
      ctx.translate(-c, -c);
      soft(122, 0.6);
      ctx.restore();
      ctx.save();
      ctx.translate(c, c);
      ctx.scale(1, 1 / 1.6);
      ctx.translate(-c, -c);
      soft(40, 0.75);
      ctx.restore();
      break;
    }
    default:
      return null;
  }

  return canvas;
}
