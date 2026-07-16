/**
 * Shared canvas helpers for the Stars-tab generators. Kept in one module so
 * the per-morphology galaxy bakes (galaxyMorph.ts) and the main generator
 * dispatch (generators.ts) build sprites onto the same opaque-black,
 * alpha-folded contract the bundled flare textures follow.
 */
import type { Rgba } from '../core/layers';

/** Baked sprite edge length in pixels. */
export const GEN_SIZE = 384;

export function makeCanvas(size = GEN_SIZE): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  return { canvas, ctx };
}

/** Rgba (0..1 channels) -> `rgba()` string with an optional alpha override. */
export const cssRgba = (c: Rgba, a = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

/**
 * Composite a sprite onto opaque black, folding alpha into RGB. Flare layers
 * commonly blend additively (one/one), which ignores source alpha — without
 * this, semi-transparent pixels (e.g. faint ring bands) would render at full
 * unpremultiplied brightness. Black-background opaque is the same contract
 * the bundled flare textures follow.
 */
/**
 * Radial containment window: fade RGB to zero before the canvas edge so no
 * bake ever ends in a hard box boundary when billboarded. `start` is the
 * radius (fraction of the half-size) where the fade begins; content within
 * it is untouched. Mutates and returns the canvas.
 */
export function windowSpriteEdges(canvas: HTMLCanvasElement, start = 0.94): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const half = Math.min(cx, cy);
  const span = 1 - start;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const e = Math.hypot(px - cx, py - cy) / half;
      if (e <= start) continue;
      const t = e >= 1 ? 0 : (1 - e) / span;
      const f = t * t * (3 - 2 * t); // smoothstep
      const o = (py * width + px) * 4;
      img.data[o] *= f;
      img.data[o + 1] *= f;
      img.data[o + 2] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Opaque-body alpha for a premultiplied (black-flattened) body sprite:
 * opaque inside the disc (AA band), luminance-alpha outside. Lets planet/sun
 * bakes occlude the sky when used with blend one / one_minus_src_alpha.
 */
export function bodyAlphaCanvas(canvas: HTMLCanvasElement, discRadiusPx: number, aa = 1.5): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const o = (py * canvas.width + px) * 4;
      const d = Math.hypot(px - cx, py - cy);
      const cover = d <= discRadiusPx - aa ? 1
        : d >= discRadiusPx + aa ? 0
        : (discRadiusPx + aa - d) / (2 * aa);
      const lum = Math.max(img.data[o], img.data[o + 1], img.data[o + 2]);
      img.data[o + 3] = Math.max(Math.round(255 * cover), lum);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Deterministic ±1 LSB dither: smooth analytic gradients (star glow, halos,
 * discs) quantize to visible concentric bands in 8-bit — a hash-based
 * half-LSB jitter converts the bands into imperceptible noise. Pure black
 * pixels are left untouched so backgrounds stay black.
 */
export function ditherCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const w = canvas.width;
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < w; px++) {
      const o = (py * w + px) * 4;
      if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0) continue;
      const h = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
      const n = Math.round((h - Math.floor(h) - 0.5) * 1.6); // -1, 0, +1
      d[o] = Math.max(0, Math.min(255, d[o] + n));
      d[o + 1] = Math.max(0, Math.min(255, d[o + 1] + n));
      d[o + 2] = Math.max(0, Math.min(255, d[o + 2] + n));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Zoom a bake about its center (universal PCG size control): zoom > 1 crops
 * in, zoom < 1 shrinks the object leaving margin. Mutates and returns.
 */
export function zoomCanvas(canvas: HTMLCanvasElement, zoom: number): HTMLCanvasElement {
  if (!zoom || Math.abs(zoom - 1) < 1e-3) return canvas;
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  scratch.getContext('2d')!.drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width * zoom;
  const h = canvas.height * zoom;
  ctx.drawImage(scratch, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas;
}

export function flattenOntoBlack(source: HTMLCanvasElement): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(source.width);
  ctx.drawImage(source, 0, 0);
  return canvas;
}
