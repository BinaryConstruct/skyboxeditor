/**
 * Procedural sprite generators for the Stars-tab workbench: parameterized
 * star flares, spiral galaxies, and planets, baked to canvases and saved
 * into the sprite store ("Bake to Sprites"). All randomness comes from the
 * MSVC LCG so a given seed always bakes the same sprite.
 */
import { kelvinToRgb } from '../core/blackbody';
import type { Rgba } from '../core/layers';
import { PerlinNoise } from '../core/perlin';
import { MsvcRng } from '../core/rng';
import { gaussianCore, ring, spike } from '../render/proceduralFlares';
import {
  bakeDeepField, bakeEdgeOnGalaxy, bakeEllipticalGalaxy, bakeGlobularCluster, bakeInteractingGalaxy,
} from './galaxyMorph';
import { GEN_SIZE, cssRgba as css, flattenOntoBlack, makeCanvas } from './genCommon';
import { geometricSeries } from './pcgMath';
import { DEFAULT_ANOMALY, bakeAnomalyGen } from './anomalyGen';

export { GEN_SIZE };

// -------------------------------------------------------------- bake modes

/**
 * Output modes for "Bake to Sprites":
 * - color: the generator's full-color output, for additive layers.
 * - lightness: grayscale luminance, so the flare layer's own color tints it
 *   (like the bundled white flares).
 * - dark: inverted luminance — empty space white, dense cloud dark — for
 *   multiply blending (layer blend factors dest_colour / zero), which lets
 *   dark nebula lanes actually darken the sky behind them.
 */
export type BakeMode = 'color' | 'lightness' | 'dark';

/** Rec.709 luminance transform applied in place; pure so it's testable. */
export function applyBakeMode(data: Uint8ClampedArray, mode: BakeMode): void {
  if (mode === 'color') return;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const v = Math.round(mode === 'lightness' ? lum : 255 - lum);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    if (mode === 'dark') data[i + 3] = 255; // multiply sprites must be opaque
  }
}

/** Apply a bake mode to a generator canvas (no-op for full color). */
export function applyBakeModeToCanvas(canvas: HTMLCanvasElement, mode: BakeMode): HTMLCanvasElement {
  if (mode === 'color') return canvas;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyBakeMode(img.data, mode);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ------------------------------------------------------------- star flare

export interface FlareGenParams {
  coreRadius: number;   // 10..140
  spikes: number;       // 0..8
  spikeLength: number;  // 20..190
  spikeAngle: number;   // 0..90 base rotation
  halo: number;         // 0..1
  kelvin: number;       // 2000..20000 blackbody tint; ~6600 is near-white
}

export const DEFAULT_FLARE: FlareGenParams = {
  coreRadius: 60,
  spikes: 4,
  spikeLength: 150,
  spikeAngle: 45,
  halo: 0,
  kelvin: 6600,
};

export function bakeFlareGen(p: FlareGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  ctx.globalCompositeOperation = 'lighter';
  const scale = GEN_SIZE / 256; // primitives are tuned for 256
  ctx.save();
  ctx.scale(scale, scale);
  gaussianCore(ctx, p.coreRadius);
  for (let i = 0; i < p.spikes; i++) {
    spike(ctx, p.spikeAngle + (i * 180) / Math.max(1, p.spikes), p.spikeLength, 3, 0.95);
  }
  if (p.halo > 0) ring(ctx, p.coreRadius * 1.6, 14, 0.35 * p.halo);
  ctx.restore();
  // blackbody tint: multiply leaves the black background black and maps the
  // white primitives onto the star's temperature color
  const tint = kelvinToRgb(p.kelvin);
  if (tint.r < 1 || tint.g < 1 || tint.b < 1) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = css(tint);
    ctx.fillRect(0, 0, GEN_SIZE, GEN_SIZE);
  }
  return canvas;
}

// ---------------------------------------------------------- spiral galaxy

/**
 * Galaxy morphology. 'spiral' is the original particle-cloud path; the others
 * are dispatched to galaxyMorph.ts (analytic Sérsic elliptical, sech² edge-on
 * disk, Plummer/King globular cluster, restricted-3-body interacting pair).
 */
export type GalaxyMorphology = 'spiral' | 'elliptical' | 'edge-on' | 'globular' | 'interacting' | 'deep-field';

export interface GalaxyGenParams {
  seed: number;
  /** Which morphology to bake; defaults to 'spiral' when omitted. */
  morphology?: GalaxyMorphology;
  // --- spiral (also reused as the warm/cool palette + bulge size elsewhere) ---
  arms: number;        // 1..6
  windings: number;    // 0.3..2 (full turns per arm)
  tiltDeg: number;     // 0 face-on .. 80 near edge-on
  bulgeSize: number;   // 0.1..0.6 (also Sérsic Re / edge-on bulge Re)
  bulgeKelvin: number; // warm core temp
  armKelvin: number;   // cool arm temp
  spread: number;      // 0..1 arm looseness
  dust: number;        // 0..1
  particles: number;   // 500..8000
  // --- elliptical / edge-on shared: orientation ---
  paDeg?: number;      // 0..180 position angle
  // --- elliptical / S0 ---
  sersicN?: number;    // 0.8..5 (4 = de Vaucouleurs)
  axisRatio?: number;  // 0.45..0.95 (E0..E6)
  // --- edge-on disk ---
  scaleHeight?: number; // 0.05..0.3 vertical scale height / radial scale length
  dustDepth?: number;   // 0..4 central dust optical depth
  laneOffset?: number;  // -0.5..0.5 dust lane offset from midplane (in z0)
  warpAmount?: number;  // 0..1 integral-sign warp
  // --- globular cluster ---
  coreRadius?: number;  // 0.04..0.25 Plummer scale radius (fraction of sprite)
  tidalRatio?: number;  // 6..16 King tidal radius / core radius
  stars?: number;       // 400..4000 resolved star count
  coreGlow?: number;    // 0..1 unresolved core glow
  blueFraction?: number; // 0..0.1 blue-straggler fraction
  // --- interacting pair ---
  massRatio?: number;   // 0.2..1 companion / primary mass
  periDistance?: number; // 0.15..0.6 pericenter separation (fraction of sprite)
  phase?: number;       // 0..1 how far past closest approach (tail length)
}

export const DEFAULT_GALAXY: GalaxyGenParams = {
  seed: 1,
  morphology: 'spiral',
  arms: 2,
  windings: 1.1,
  tiltDeg: 35,
  bulgeSize: 0.28,
  bulgeKelvin: 4200,
  armKelvin: 9500,
  spread: 0.35,
  dust: 0.35,
  particles: 4000,
  paDeg: 30,
  sersicN: 4,
  axisRatio: 0.7,
  scaleHeight: 0.14,
  dustDepth: 2.4,
  laneOffset: -0.15,
  warpAmount: 0.25,
  coreRadius: 0.12,
  tidalRatio: 11,
  stars: 2200,
  coreGlow: 0.7,
  blueFraction: 0.02,
  massRatio: 0.6,
  periDistance: 0.28,
  phase: 0.6,
};

export function bakeGalaxyGen(p: GalaxyGenParams): HTMLCanvasElement {
  switch (p.morphology) {
    case 'elliptical': return bakeEllipticalGalaxy(p);
    case 'edge-on': return bakeEdgeOnGalaxy(p);
    case 'globular': return bakeGlobularCluster(p);
    case 'interacting': return bakeInteractingGalaxy(p);
    case 'deep-field': return bakeDeepField(p);
    default: break; // 'spiral' (and undefined) fall through to the particle path
  }
  // paint face-on into a working canvas, then project with the tilt
  const work = makeCanvas();
  const ctx = work.ctx;
  const c = GEN_SIZE / 2;
  const R = GEN_SIZE * 0.46;
  const rng = new MsvcRng(p.seed >>> 0);

  const bulgeColor = kelvinToRgb(p.bulgeKelvin);
  const armColor = kelvinToRgb(p.armKelvin);

  ctx.globalCompositeOperation = 'lighter';

  // bulge
  const bulgeR = R * p.bulgeSize;
  const bg = ctx.createRadialGradient(c, c, 0, c, c, bulgeR * 2.2);
  bg.addColorStop(0, css(bulgeColor, 0.95));
  bg.addColorStop(0.35, css(bulgeColor, 0.4));
  bg.addColorStop(1, css(bulgeColor, 0));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, GEN_SIZE, GEN_SIZE);

  // arm particles along logarithmic-ish spirals, with kink waves + knots so
  // the arms read ragged like JWST spirals rather than mathematical curves
  const armOffset = (Math.PI * 2) / Math.max(1, p.arms);
  const kinkPhase = rng.unit() * Math.PI * 2;
  const kinkPhase2 = rng.unit() * Math.PI * 2;
  for (let i = 0; i < p.particles; i++) {
    const arm = i % Math.max(1, p.arms);
    const t = Math.sqrt(rng.unit()); // denser toward the center
    const kink =
      0.30 * p.spread * Math.sin(t * 9.2 + arm * 2.1 + kinkPhase) +
      0.16 * p.spread * Math.sin(t * 23.7 + kinkPhase2 + arm);
    const theta = t * p.windings * Math.PI * 2 + arm * armOffset + kink
      + (rng.unit() - 0.5) * p.spread * (2.2 - t);
    const knot = 0.5 + 0.5 * Math.sin(t * 56 + arm * 4 + kinkPhase);
    const radius = bulgeR * 0.5 + t * (R - bulgeR * 0.5)
      * (1 + (rng.unit() - 0.5) * p.spread * 0.5);
    const x = c + radius * Math.cos(theta);
    const y = c + radius * Math.sin(theta);

    const mix = Math.min(1, t * 1.3);
    const col: Rgba = {
      r: bulgeColor.r + mix * (armColor.r - bulgeColor.r),
      g: bulgeColor.g + mix * (armColor.g - bulgeColor.g),
      b: bulgeColor.b + mix * (armColor.b - bulgeColor.b),
      a: 1,
    };
    const size = (1 + rng.unit() * 2.4 * (1.2 - t * 0.6)) * (0.85 + 0.3 * knot);
    const alpha = (0.05 + 0.16 * (1 - t * 0.55) * (0.5 + rng.unit() * 0.5)) * (0.75 + 0.5 * knot);

    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.4);
    g.addColorStop(0, css(col, Math.min(1, alpha)));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - size * 2.4, y - size * 2.4, size * 4.8, size * 4.8);
  }

  // inter-arm web: faint filamentary fill between the arms — the connective
  // tissue visible in JWST imagery instead of empty black gaps
  const webParticles = Math.floor(p.particles * 0.3);
  for (let i = 0; i < webParticles; i++) {
    const tW = 0.2 + 0.8 * Math.sqrt(rng.unit());
    const thW = rng.unit() * Math.PI * 2;
    const phase = thW - tW * p.windings * Math.PI * 2;
    let dMin = Math.PI;
    for (let a = 0; a < Math.max(1, p.arms); a++) {
      const d = Math.abs(((phase - a * armOffset) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      dMin = Math.min(dMin, d);
    }
    const gap = dMin / (armOffset / 2);
    const strand = 0.5 + 0.5 * Math.sin(gap * 6.5 + tW * 9 + kinkPhase2);
    const bright = 0.03 + 0.075 * strand * (1 - tW * 0.5);
    if (bright < 0.035) continue;
    const radius = (bulgeR * 0.5 + tW * (R - bulgeR * 0.5)) * (1 + (rng.unit() - 0.5) * 0.1);
    const x = c + radius * Math.cos(thW);
    const y = c + radius * Math.sin(thW);
    const mixw = 0.65;
    const col: Rgba = {
      r: (bulgeColor.r + mixw * (armColor.r - bulgeColor.r)) * 0.9,
      g: (bulgeColor.g + mixw * (armColor.g - bulgeColor.g)) * 0.95,
      b: (bulgeColor.b + mixw * (armColor.b - bulgeColor.b)) * 1.05,
      a: 1,
    };
    const size = 1.2 + rng.unit() * 2.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.6);
    g.addColorStop(0, css(col, bright));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - size * 2.6, y - size * 2.6, size * 5.2, size * 5.2);
  }

  // dust lanes: darken along an inward-offset spiral
  if (p.dust > 0) {
    ctx.globalCompositeOperation = 'source-over';
    const dustParticles = Math.floor(p.particles * 0.35);
    for (let i = 0; i < dustParticles; i++) {
      const arm = i % Math.max(1, p.arms);
      const t = 0.25 + 0.7 * rng.unit();
      const theta = t * p.windings * Math.PI * 2 + arm * armOffset - 0.18
        + (rng.unit() - 0.5) * p.spread * 0.6;
      const radius = (bulgeR * 0.5 + t * (R - bulgeR * 0.5)) * 0.94;
      const x = c + radius * Math.cos(theta);
      const y = c + radius * Math.sin(theta);
      const size = 2 + rng.unit() * 4;
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
      g.addColorStop(0, `rgba(0,0,0,${0.22 * p.dust})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - size * 2, y - size * 2, size * 4, size * 4);
    }
  }

  // tilt projection
  const out = makeCanvas();
  const squash = Math.max(0.12, Math.cos((p.tiltDeg * Math.PI) / 180));
  out.ctx.translate(c, c);
  out.ctx.scale(1, squash);
  out.ctx.translate(-c, -c);
  out.ctx.drawImage(work.canvas, 0, 0);
  return out.canvas;
}

// -------------------------------------------------------------------- sun

/**
 * Sun styles: the OBAFGKM main sequence plus structural remnants/giants and
 * two star+disc composition styles. 'g' at defaults reproduces the historic
 * DEFAULT_SUN output byte-for-byte (all style-specific code paths gate to a
 * no-op there). 'pulsar' dispatches to the anomaly baker — see anomalyGen.ts.
 * (Docs/Plans/2026-07-16-pcg-stellar-styles.md §3–5.)
 */
export type SunStyle =
  | 'o' | 'b' | 'a' | 'f' | 'g' | 'k' | 'm'
  | 'white-dwarf' | 'red-dwarf' | 'brown-dwarf'
  | 'red-giant' | 'red-supergiant' | 'blue-giant'
  | 'pulsar' | 'dust-ring' | 'solar-system';

export interface SunGenParams {
  seed: number;
  /** which stellar style; omitted = 'g' (the legacy sun) */
  style?: SunStyle;
  kelvin: number;          // 2000..40000 photosphere temperature
  discRadius: number;      // 0.03..0.3 fraction of the sprite
  limbDarkening: number;   // 0..1
  granulation: number;     // 0..1 photosphere convection-cell texture
  corona: number;          // 0..1 streamer intensity
  coronaExtent: number;    // 0.3..2.5 how far streamers reach, in disc radii
  prominences: number;     // 0..1 red limb loops/arcs
  glow: number;            // 0..1 broad soft halo
  // --- shared style params (default to the legacy G behaviour when omitted) ---
  granuleScale?: number;   // 2..40 spatial frequency of the granulation FBM (14 = legacy)
  ambientWisp?: number;    // 0..1 faint star-tinted nebulosity haze
  spikes?: number;         // 0..8 diffraction spikes over the finished disc
  ionizedShell?: number;   // 0..1 faint ejected-shell ring (young white dwarf)
  magentaMix?: number;     // 0..1 brown-dwarf violet/magenta body tint
  // --- dust-ring composition ---
  ringInner?: number;      // 3..12 ring inner radius, in star radii
  ringOuter?: number;      // 3.5..14 ring outer radius, in star radii
  ringTilt?: number;       // 10..80 ring plane tilt
  ringOpacity?: number;    // 0..1
  ringKelvin?: number;     // 2000..12000 ring dust illumination tint
  // --- solar-system (protoplanetary disc) composition ---
  discTilt?: number;       // 0..70 disc tilt (0 face-on)
  discPA?: number;         // 0..180 position angle
  gapCount?: number;       // 0..6 concentric gaps
  gapRatio?: number;       // 1.35..1.9 geometric gap spacing
  gapWidth?: number;       // 0.04..0.12 gap width fraction
  discBrightness?: number; // 0..2 surface-brightness scale
  scatter?: number;        // 0..0.6 forward-scatter near-side brightening
  planets?: number;        // 0..3 point-sized planets sitting in gaps
  discKelvin?: number;     // 2000..8000 disc dust tint
}

export const DEFAULT_SUN: SunGenParams = {
  seed: 3,
  style: 'g',
  kelvin: 5800,
  discRadius: 0.16,
  limbDarkening: 0.6,
  granulation: 0.35,
  corona: 0.7,
  coronaExtent: 1.4,
  prominences: 0.4,
  glow: 0.5,
  granuleScale: 14,
  ambientWisp: 0,
  spikes: 0,
};

/**
 * Style presets the UI applies on style change (mirrors NEBULA_STYLE_DEFAULTS).
 * Each is a Partial<SunGenParams>; unspecified fields keep their current value.
 * The 'g' preset must equal DEFAULT_SUN's stellar fields for byte-stability.
 */
export const SUN_STYLE_DEFAULTS: Record<SunStyle, Partial<SunGenParams>> = {
  o: { kelvin: 40000, discRadius: 0.15, limbDarkening: 0.25, granulation: 0.05, granuleScale: 20, corona: 0.35, coronaExtent: 0.9, prominences: 0, glow: 0.85, ambientWisp: 0.5, spikes: 4 },
  b: { kelvin: 16000, discRadius: 0.16, limbDarkening: 0.58, granulation: 0.08, granuleScale: 20, corona: 0.4, coronaExtent: 1.0, prominences: 0, glow: 0.75, ambientWisp: 0.35, spikes: 0 },
  a: { kelvin: 8500, discRadius: 0.16, limbDarkening: 0.73, granulation: 0.15, granuleScale: 18, corona: 0.45, coronaExtent: 1.1, prominences: 0.05, glow: 0.6, ambientWisp: 0.2, spikes: 0 },
  f: { kelvin: 6800, discRadius: 0.16, limbDarkening: 0.76, granulation: 0.25, granuleScale: 16, corona: 0.55, coronaExtent: 1.2, prominences: 0.2, glow: 0.55, ambientWisp: 0.1, spikes: 0 },
  g: { kelvin: 5800, discRadius: 0.16, limbDarkening: 0.6, granulation: 0.35, granuleScale: 14, corona: 0.7, coronaExtent: 1.4, prominences: 0.4, glow: 0.5, ambientWisp: 0, spikes: 0 },
  k: { kelvin: 4400, discRadius: 0.17, limbDarkening: 0.81, granulation: 0.45, granuleScale: 12, corona: 0.6, coronaExtent: 1.2, prominences: 0.55, glow: 0.45, ambientWisp: 0, spikes: 0 },
  m: { kelvin: 3100, discRadius: 0.17, limbDarkening: 0.84, granulation: 0.6, granuleScale: 10, corona: 0.45, coronaExtent: 0.9, prominences: 0.85, glow: 0.4, ambientWisp: 0, spikes: 0 },
  'white-dwarf': { kelvin: 18000, discRadius: 0.05, limbDarkening: 0.15, granulation: 0, corona: 0, coronaExtent: 0.5, prominences: 0, glow: 0.9, spikes: 4, ionizedShell: 0, ambientWisp: 0 },
  'red-dwarf': { kelvin: 3000, discRadius: 0.09, limbDarkening: 0.84, granulation: 0.5, granuleScale: 10, corona: 0.2, coronaExtent: 0.8, prominences: 0.9, glow: 0.3, ambientWisp: 0, spikes: 0 },
  'brown-dwarf': { kelvin: 1600, discRadius: 0.11, limbDarkening: 0.2, granulation: 0, corona: 0, coronaExtent: 0.5, prominences: 0, glow: 0.15, magentaMix: 0.5, ambientWisp: 0, spikes: 0 },
  'red-giant': { kelvin: 3400, discRadius: 0.24, limbDarkening: 0.85, granulation: 0.8, corona: 0.1, coronaExtent: 1.0, prominences: 0.1, glow: 0.8, ambientWisp: 0, spikes: 0 },
  'red-supergiant': { kelvin: 3300, discRadius: 0.28, limbDarkening: 0.85, granulation: 0.85, corona: 0.1, coronaExtent: 1.0, prominences: 0.1, glow: 0.85, ambientWisp: 0, spikes: 0 },
  'blue-giant': { kelvin: 22000, discRadius: 0.2, limbDarkening: 0.35, granulation: 0.05, granuleScale: 20, corona: 0.25, coronaExtent: 1.6, prominences: 0, glow: 0.7, ambientWisp: 0.15, spikes: 0 },
  pulsar: { kelvin: 25000, discRadius: 0.04, limbDarkening: 0.2, granulation: 0, corona: 0.2, coronaExtent: 0.9, prominences: 0, glow: 0.6, spikes: 2, ambientWisp: 0 },
  'dust-ring': { kelvin: 7000, discRadius: 0.07, limbDarkening: 0.5, granulation: 0.2, corona: 0.2, coronaExtent: 1.0, prominences: 0, glow: 0.5, ringInner: 6, ringOuter: 8, ringTilt: 55, ringOpacity: 0.3, ringKelvin: 5000, ambientWisp: 0, spikes: 0 },
  'solar-system': { kelvin: 4200, discRadius: 0.05, limbDarkening: 0.5, granulation: 0.2, corona: 0.1, coronaExtent: 0.8, prominences: 0, glow: 0.4, discTilt: 50, discPA: 30, gapCount: 5, gapRatio: 1.55, gapWidth: 0.07, discBrightness: 1, scatter: 0.35, planets: 2, discKelvin: 3800, ambientWisp: 0, spikes: 0 },
};

/**
 * Sun / star close-up dispatcher. The disc-based stellar styles (spectral
 * sequence, dwarfs, giants) share the photosphere path; 'dust-ring' and
 * 'solar-system' are star+disc composites; 'pulsar' dispatches to the anomaly
 * baker. 'g' at defaults is byte-identical to the historic output.
 */
export function bakeSunGen(p: SunGenParams, size = GEN_SIZE): HTMLCanvasElement {
  const style = p.style ?? 'g';
  if (style === 'pulsar') return bakeSunPulsar(p);
  if (style === 'dust-ring') return bakeDustRing(p);
  if (style === 'solar-system') return bakeSolarSystem(p);
  return bakePhotosphere(p, style, size);
}

/**
 * sun-mode 'pulsar' style: dispatches to the shared anomaly lighthouse-beam
 * baker (anomalyGen.ts §6.10) so there's a single pulsar recipe — same
 * pattern as bakeGalaxyGen dispatching to galaxyMorph.ts.
 */
function bakeSunPulsar(p: SunGenParams): HTMLCanvasElement {
  return bakeAnomalyGen({ ...DEFAULT_ANOMALY, seed: p.seed, style: 'pulsar', coreKelvin: p.kelvin });
}

/**
 * Photosphere-based star: limb-darkened disc with granulation (or giant-cell
 * mottling / gas-giant banding), angular-noise corona streamers, Halpha
 * prominence arcs, and a soft halo — plus optional rim-brightening, ambient
 * wisp, diffraction spikes, and an ejected shell. Per-pixel, deterministic.
 */
function bakePhotosphere(p: SunGenParams, style: SunStyle, size = GEN_SIZE): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  const R = size * p.discRadius;
  const noise = new PerlinNoise(p.seed >>> 0);
  const img = ctx.createImageData(size, size);

  const gs = p.granuleScale ?? 14;
  const wisp = p.ambientWisp ?? 0;
  const isGiant = style === 'red-giant' || style === 'red-supergiant';
  const isSupergiant = style === 'red-supergiant';
  const cellScale = isSupergiant ? 2.0 : 2.6;
  const rimBright = style === 'blue-giant';
  const isWhiteDwarf = style === 'white-dwarf';
  const isBrown = style === 'brown-dwarf';

  // body color; brown dwarfs read violet/magenta (Na-D absorption), not the
  // deep orange-red kelvinToRgb bottoms out at
  let body = kelvinToRgb(p.kelvin);
  if (isBrown) {
    const m = p.magentaMix ?? 0.35;
    body = {
      r: body.r + m * (0.55 - body.r),
      g: body.g + m * (0.12 - body.g),
      b: body.b + m * (0.55 - body.b),
      a: 1,
    };
  }
  // giant mottling color anchors (hot cell tops / cool dark lanes)
  const hotCol = kelvinToRgb(p.kelvin + 500);
  const coolCol = kelvinToRgb(Math.max(1200, p.kelvin - 600));
  // prominences glow in Halpha red regardless of photosphere temp
  const ha = { r: 1.0, g: 0.25, b: 0.18 };
  // cool-star saturation: the whiteMix wash is scaled down below ~K so cool
  // discs stay saturated (G and hotter keep the legacy 0.55·mu wash exactly)
  const coolCap = p.kelvin < 5200 ? Math.min(1, p.kelvin / 6000) : 1;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px - c) / R;
      const dy = (py - c) / R;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      // window everything outside the disc to zero before the canvas edge,
      // so the sprite never shows a hard quad boundary when billboarded
      const edge = Math.hypot(px - c, py - c) / c;
      const window = edge >= 1 ? 0 : edge <= 0.72 ? 1
        : 1 - (edge - 0.72) / 0.28;
      const smooth = window * window * (3 - 2 * window);

      let cr = 0;
      let cg = 0;
      let cb = 0;

      // supergiants aren't round: wobble the disc edge with low-freq noise
      const discEdge = isSupergiant
        ? 1 + 0.08 * noise.fbm(Math.cos(theta) * 1.3 + 21, Math.sin(theta) * 1.3, 0.5, 2, 0.5, 2)
        : 1;
      const rn = r / discEdge;

      // antialiased disc boundary: ~1.5px coverage band instead of a hard cut
      const aa = 1.5 / R;
      const discCover = rn <= 1 - aa ? 1 : rn >= 1 + aa ? 0 : (1 + aa - rn) / (2 * aa);

      if (discCover > 0) {
        // photosphere: Eddington limb darkening I(mu) = 1 - u(1 - mu)
        const rd = Math.min(rn, 1);
        const mu = Math.sqrt(Math.max(0, 1 - rd * rd));
        let b = 1 - p.limbDarkening * (1 - mu);
        let col = body;
        if (isGiant && p.granulation > 0) {
          // two-scale mottle: a handful of giant convection cells + fine grain
          const cells = noise.fbm(dx * cellScale + 5.1, dy * cellScale, 0.5, 3, 0.5, 2);
          const fine = noise.fbm(dx * 9 + 2.2, dy * 9, 0.5, 3, 0.5, 2);
          b *= 1 + 0.38 * p.granulation * cells + 0.10 * p.granulation * fine;
          const t = 0.5 + 0.5 * cells;
          col = {
            r: coolCol.r + t * (hotCol.r - coolCol.r),
            g: coolCol.g + t * (hotCol.g - coolCol.g),
            b: coolCol.b + t * (hotCol.b - coolCol.b),
            a: 1,
          };
        } else if (isBrown) {
          // failed star: gas-giant banding on the disc instead of granulation
          const bn = noise.fbm(dx * 3, dy * 3, 0.5, 3, 0.5, 2);
          const bands = 0.5 + 0.5 * Math.sin(dy * 7 + bn * 4);
          b *= 0.85 + 0.3 * bands;
        } else if (p.granulation > 0) {
          const g = noise.fbm(dx * gs, dy * gs, 0.7, 4, 0.55, 2.1);
          b *= 1 + g * 0.22 * p.granulation;
        }
        // blue-giant rim brightening: a bright scattering shell at the limb
        if (rimBright) {
          b += 0.5 * Math.exp(-Math.pow((rn - 0.97) / 0.05, 2));
        }
        // white-hot center blending toward the blackbody hue at the limb;
        // brown dwarfs are self-luminous and stay saturated (no white wash)
        const whiteMix = isBrown ? 0 : 0.55 * mu * coolCap;
        cr = (col.r + (1 - col.r) * whiteMix) * b * discCover;
        cg = (col.g + (1 - col.g) * whiteMix) * b * discCover;
        cb = (col.b + (1 - col.b) * whiteMix) * b * discCover;
      }
      if (discCover < 1) {
        // environment contributions, faded in across the same AA band
        const env = 1 - discCover;
        const re = Math.max(rn, 1); // corona/halo formulas assume r >= 1
        // corona: angular ridged noise -> radial streamers with varying reach
        if (p.corona > 0) {
          const lobes = Math.abs(noise.fbm(Math.cos(theta) * 2.3 + 7.1, Math.sin(theta) * 2.3, 0.5, 4, 0.55, 2.0));
          const reach = p.coronaExtent * (0.25 + 1.5 * lobes);
          const cor = p.corona * Math.exp(-(re - 1) / Math.max(0.05, reach * 0.45)) * env;
          const streak = 0.35 + 0.65 * lobes;
          cr += cor * streak * (0.6 + 0.4 * body.r);
          cg += cor * streak * (0.6 + 0.4 * body.g);
          cb += cor * streak * (0.62 + 0.38 * body.b);
        }
        // prominences: noise-gated arcs hugging the limb
        if (p.prominences > 0 && rn < 1.3) {
          const arc = noise.fbm(Math.cos(theta) * 3.7, Math.sin(theta) * 3.7 + 51.3, 0.9, 3, 0.5, 2.0);
          const gate = Math.max(0, arc - (1 - p.prominences * 0.55));
          const shell = Math.exp(-Math.pow((rn - 1.06) / 0.07, 2));
          const pr = gate * shell * 3.2;
          cr += ha.r * pr;
          cg += ha.g * pr;
          cb += ha.b * pr;
        }
        // halo — re, not rn: pow(negative, exp) is NaN inside the AA band and
        // NaN pixels write as black (the "dark ring" bug). White dwarfs get a
        // tight compact glow; giants a broad reaching one.
        if (p.glow > 0) {
          let halo: number;
          if (isWhiteDwarf) {
            halo = p.glow * (Math.exp(-Math.pow((re - 1) / 0.35, 1.6)) + 0.12 * Math.exp(-(re - 1) / 1.8));
          } else if (isGiant) {
            halo = p.glow * 0.6 * Math.exp(-Math.pow((re - 1) / 3.2, 1.1));
          } else {
            halo = p.glow * 0.6 * Math.exp(-Math.pow((re - 1) / 2.4, 1.3));
          }
          const tint = rimBright ? { r: body.r, g: body.g, b: Math.min(1, body.b + 0.15) } : body;
          cr += halo * tint.r;
          cg += halo * tint.g;
          cb += halo * tint.b;
        }
        cr *= smooth;
        cg *= smooth;
        cb *= smooth;
      }

      // ambient star-tinted nebulosity haze across the whole sprite
      if (wisp > 0) {
        const nx = (px - c) / c;
        const ny = (py - c) / c;
        const wv = noise.fbm(nx * 2.2 + 30, ny * 2.2, 0.5, 2, 0.5, 2) * 0.5 + 0.5;
        const a = 0.10 * wisp * wv * smooth;
        cr += a * body.r;
        cg += a * body.g;
        cb += a * body.b;
      }

      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, cr * 255);
      img.data[o + 1] = Math.min(255, cg * 255);
      img.data[o + 2] = Math.min(255, cb * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // faint ejected planetary-nebula shell around a young white dwarf
  if ((p.ionizedShell ?? 0) > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rr = R * 2.7;
    const g = ctx.createRadialGradient(c, c, rr * 0.8, c, c, rr * 1.25);
    g.addColorStop(0, 'rgba(60,180,170,0)');
    g.addColorStop(0.5, `rgba(70,200,190,${0.18 * (p.ionizedShell ?? 0)})`);
    g.addColorStop(1, 'rgba(60,180,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // diffraction spikes over the finished disc (the "intense point" tell)
  const nSpikes = p.spikes ?? 0;
  if (nSpikes > 0) drawSunSpikes(ctx, nSpikes, p.discRadius);

  return canvas;
}

/**
 * Additive diffraction spikes centered on the disc, scaled from 256-space.
 * Left white-hot — real diffraction spikes are near-white regardless of the
 * source hue.
 */
function drawSunSpikes(
  ctx: CanvasRenderingContext2D, count: number, discRadius: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const scale = GEN_SIZE / 256;
  ctx.scale(scale, scale);
  // length ~4 disc radii, expressed in 256-space (GEN_SIZE·discRadius/scale·4)
  const len = Math.min(120, 1024 * discRadius);
  for (let i = 0; i < count; i++) {
    spike(ctx, 45 + (i * 180) / count, len, 2.5, 0.9);
  }
  ctx.restore();
}

/**
 * dust-ring style: a small star with a far-out, thin, tilted debris/dust
 * annulus (Fomalhaut-like). Additive elliptical bands with forward-scatter
 * near-side brightening and a faint inner-clearing glow.
 */
function bakeDustRing(p: SunGenParams): HTMLCanvasElement {
  const canvas = bakePhotosphere(p, 'g'); // small plain star body via preset
  const ctx = canvas.getContext('2d')!;
  const size = GEN_SIZE;
  const c = size / 2;
  const R = size * p.discRadius;
  const inner = (p.ringInner ?? 6) * R;
  const outer = (p.ringOuter ?? 8) * R;
  const tilt = ((p.ringTilt ?? 55) * Math.PI) / 180;
  const squash = Math.max(0.06, Math.cos(tilt));
  const opacity = p.ringOpacity ?? 0.3;
  const noise = new PerlinNoise((p.seed + 0x2b1d) >>> 0);
  const dust = { r: 0.75, g: 0.62, b: 0.5 };
  const lit = kelvinToRgb(p.ringKelvin ?? 5000);
  const col = { r: lit.r * 0.5 + dust.r * 0.5, g: lit.g * 0.5 + dust.g * 0.5, b: lit.b * 0.5 + dust.b * 0.5, a: 1 };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const steps = 46;
  const bandW = (outer - inner) / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const radius = inner + t * (outer - inner);
    const band = noise.fbm(t * 5.2 + 17.3, 8.8, 0.5, 3, 0.5, 2) * 0.5 + 0.5;
    // draw the ellipse as a stroked polyline so azimuthal forward-scatter can
    // brighten the near (bottom) side (1 + 0.5·sin az)
    const segs = 96;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      const scat = 1 + (p.scatter ?? 0.5) * Math.sin((a0 + a1) / 2);
      const alpha = opacity * Math.max(0, band * 1.35 - 0.25) * scat * 0.6;
      if (alpha <= 0.004) continue;
      ctx.strokeStyle = css(col, Math.min(1, alpha));
      ctx.lineWidth = bandW * 1.3;
      ctx.beginPath();
      ctx.ellipse(c, c, radius, radius * squash, 0, a0, a1);
      ctx.stroke();
    }
  }
  // inner-clearing zodiacal hint bridging star and ring
  const zr = inner * 0.6;
  const zg = ctx.createRadialGradient(c, c, zr * 0.4, c, c, zr);
  zg.addColorStop(0, css(col, 0));
  zg.addColorStop(0.7, css(col, 0.05 * opacity * 4));
  zg.addColorStop(1, css(col, 0));
  ctx.fillStyle = zg;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  return canvas;
}

/**
 * solar-system style: a small star with a broad tilted protoplanetary disc
 * crossed by concentric dark gaps (HL Tau look), with 1–2px planets sitting in
 * the gaps. Per-pixel disc surface brightness × geometric gap series.
 */
function bakeSolarSystem(p: SunGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const half = size / 2;
  const R = size * p.discRadius;
  const tilt = ((p.discTilt ?? 50) * Math.PI) / 180;
  const cosT = Math.max(0.15, Math.cos(tilt));
  const pa = ((p.discPA ?? 30) * Math.PI) / 180;
  const cosPa = Math.cos(pa);
  const sinPa = Math.sin(pa);
  const noise = new PerlinNoise((p.seed + 0x5109) >>> 0);
  const rng = new MsvcRng((p.seed + 0x77a1) >>> 0);

  const rIn = 1.6 * R;
  const rC = 0.42 * half;
  const gamma = 0.6;
  const gapCount = Math.round(p.gapCount ?? 5);
  const gapRatio = p.gapRatio ?? 1.55;
  const gapWFrac = p.gapWidth ?? 0.07;
  const bright = p.discBrightness ?? 1;
  const scatter = p.scatter ?? 0.35;
  // gap radii (geometric series) + per-gap depth
  const gapR = geometricSeries(rIn * 1.5, gapRatio, gapCount);
  const gapDepth = gapR.map(() => 0.55 + 0.4 * rng.unit());

  const warm = kelvinToRgb(3800);
  const coldK = kelvinToRgb(2600);
  const cold = { r: coldK.r * 0.5 + 0.45 * 0.5, g: coldK.g * 0.5 + 0.5 * 0.5, b: coldK.b * 0.5 + 0.62 * 0.5 };

  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // screen coords centered, rotated by position angle, un-tilted
      const sx = px - c;
      const sy = py - c;
      const xr = sx * cosPa + sy * sinPa;
      const yr = -sx * sinPa + sy * cosPa;
      const xd = xr;
      const yd = yr / cosT;
      const rd = Math.hypot(xd, yd);
      const az = Math.atan2(yd, xd);

      let cr = 0;
      let cg = 0;
      let cb = 0;
      if (rd > rIn * 0.7) {
        // base surface brightness: power law with tapered edge
        let sigma = Math.pow(Math.max(rd, rIn) / rIn, -gamma) * Math.exp(-Math.pow(rd / rC, 2));
        sigma *= Math.max(0, Math.min(1, (rd - rIn) / (0.3 * rIn) + 0.5)); // soft inner hole
        // gap transmission (geometric series of dark annuli)
        let trans = 1;
        for (let k = 0; k < gapR.length; k++) {
          const w = gapWFrac * gapR[k];
          trans *= 1 - gapDepth[k] * Math.exp(-Math.pow((rd - gapR[k]) / w, 2));
        }
        // azimuthal clumps + forward-scatter (near / bottom side brighter)
        const clump = 1 + 0.15 * noise.fbm(Math.cos(az) * 3 + 11, Math.sin(az) * 3 + rd * 0.02, 0.5, 3, 0.5, 2);
        const nearSide = 1 + scatter * (sy / half); // bottom (near) brighter
        let inten = bright * sigma * trans * clump * nearSide * 0.9;
        inten = Math.max(0, inten);
        // color: warm inner -> cold blue-gray outer
        const t = Math.min(1, rd / rC);
        cr = (warm.r + t * (cold.r - warm.r)) * inten;
        cg = (warm.g + t * (cold.g - warm.g)) * inten;
        cb = (warm.b + t * (cold.b - warm.b)) * inten;
      }

      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, cr * 255);
      img.data[o + 1] = Math.min(255, cg * 255);
      img.data[o + 2] = Math.min(255, cb * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // planets: 1–2px points sitting inside gaps
  const nPlanets = Math.round(p.planets ?? 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nPlanets && i < gapR.length; i++) {
    const gr = gapR[i];
    const azp = rng.unit() * Math.PI * 2;
    const xd = gr * Math.cos(azp);
    const yd = gr * Math.sin(azp) * cosT;
    // rotate back by position angle
    const x = c + (xd * cosPa - yd * sinPa);
    const y = c + (xd * sinPa + yd * cosPa);
    const pc = kelvinToRgb(4500 + rng.unit() * 4500);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 3);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, css(pc, 0.6));
    g.addColorStop(1, css(pc, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }
  ctx.restore();

  // the star on top (small disc + glow), drawn additively last
  const starCanvas = bakePhotosphere(
    { ...p, discRadius: p.discRadius, granulation: 0, corona: p.corona, prominences: 0 }, 'g');
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(starCanvas, 0, 0);
  return canvas;
}

// ----------------------------------------------------------------- planet

/**
 * One planetary ring set — a stackable planar component. Rings share the
 * planet's equatorial-plane family but each set may tilt and rotate
 * independently, with its own extent, color, opacity, and band seed.
 */
export interface RingParams {
  inner: number;      // 1.15..3 inner radius, in planet radii
  outer: number;      // 1.3..3.5 outer radius, in planet radii
  rotationDeg: number; // 0..180 in-plane rotation of the line of nodes
  tiltDeg: number;    // 5..85 viewing tilt of the ring plane
  opacity: number;    // 0..1 overall band opacity
  color: Rgba;
  bandSeed: number;   // seed for the radial band (gap/brightness) structure
}

export const DEFAULT_RING: RingParams = {
  inner: 1.45,
  outer: 2.2,
  rotationDeg: 0,
  tiltDeg: 22,
  opacity: 0.85,
  color: { r: 0.78, g: 0.7, b: 0.58, a: 1 },
  bandSeed: 1,
};

/** Planet Style: rocky (craters), terran (ocean/land/ice/clouds), gas. */
export type PlanetStyle = 'rocky' | 'terran' | 'gas';

export interface PlanetGenParams {
  seed: number;
  /** undefined keeps the legacy neutral surface (back-compat) */
  style?: PlanetStyle;
  /** rocky: 0..1 crater density */
  craters?: number;
  /** terran: 0..1 cloud coverage */
  clouds?: number;
  baseColor: Rgba;
  secondColor: Rgba;
  noiseScale: number;    // 1..8
  octaves: number;       // 2..7
  banding: number;       // 0 rocky .. 1 gas giant bands
  lightAngleDeg: number; // light direction around the disc
  atmosphereColor: Rgba;
  atmosphereWidth: number; // 0..0.25
  /** Stackable ring sets, drawn outer-planet-radii outward. Empty = no rings. */
  rings: RingParams[];
}

export const DEFAULT_PLANET: PlanetGenParams = {
  seed: 7,
  baseColor: { r: 0.16, g: 0.3, b: 0.5, a: 1 },
  secondColor: { r: 0.75, g: 0.68, b: 0.55, a: 1 },
  noiseScale: 3,
  octaves: 5,
  banding: 0,
  lightAngleDeg: 25,
  atmosphereColor: { r: 0.4, g: 0.65, b: 1, a: 1 },
  atmosphereWidth: 0.08,
  rings: [],
};

export function bakePlanetGen(p: PlanetGenParams, size = GEN_SIZE): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  // with rings on, shrink the planet so the widest ring set fits the sprite
  const rings = p.rings ?? [];
  const maxOuter = rings.reduce(
    (m, r) => (r.opacity > 0 && r.outer > r.inner ? Math.max(m, r.outer) : m), 0);
  const hasRings = maxOuter > 0;
  const R = hasRings ? (size * 0.47) / maxOuter : size * 0.42;
  const noise = new PerlinNoise(p.seed >>> 0);
  const img = ctx.createImageData(size, size);

  const la = (p.lightAngleDeg * Math.PI) / 180;
  // light from the side, slightly toward the viewer
  const L = { x: Math.cos(la) * 0.85, y: -Math.sin(la) * 0.85, z: 0.53 };

  // rocky craters: deterministic set of front-hemisphere impact sites
  const style = p.style;
  const craterRng = new MsvcRng((p.seed + 0xc4a7) >>> 0);
  const craters: Array<{ x: number; y: number; z: number; r: number }> = [];
  const nCraters = style === 'rocky' ? Math.round((p.craters ?? 0.5) * 26) : 0;
  for (let i = 0; i < nCraters; i++) {
    const cx2 = (craterRng.unit() * 2 - 1) * 0.85;
    const cy2 = (craterRng.unit() * 2 - 1) * 0.85;
    const rr2 = cx2 * cx2 + cy2 * cy2;
    if (rr2 > 0.8) continue;
    craters.push({ x: cx2, y: cy2, z: Math.sqrt(1 - rr2), r: 0.05 + craterRng.unit() * 0.14 });
  }
  const cloudNoise = style === 'terran' ? new PerlinNoise((p.seed + 0x1c10) >>> 0) : null;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px - c) / R;
      const y = (py - c) / R;
      const rr = x * x + y * y;
      // antialiased limb: ~1.5px coverage band instead of a hard cut
      const aa = 1.5 / R;
      const rad = Math.sqrt(rr);
      if (rad > 1 + aa) continue;
      const cover = rad <= 1 - aa ? 1 : (1 + aa - rad) / (2 * aa);

      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, rr)));
      // sample 3D noise on the sphere surface — no pole distortion
      let n = noise.fbm(x * p.noiseScale, y * p.noiseScale, z * p.noiseScale, p.octaves, 0.5, 2.0);
      n = n * 0.5 + 0.5;

      const banding = style === 'gas' ? Math.max(0.85, p.banding) : p.banding;
      if (banding > 0) {
        // gas style: latitude-dominant bands (noise only wiggles the belts);
        // legacy path keeps the stronger noise coupling
        const wiggle = style === 'gas' ? n * 2.2 : n * 5;
        const bands = 0.5 + 0.5 * Math.sin(y * 9 + wiggle);
        n = n + banding * (bands - n);
      }

      let r: number;
      let g: number;
      let b: number;
      if (style === 'terran') {
        // ocean / coast / land / ice palette from the elevation field
        const ice = Math.abs(y) > 0.78 + 0.08 * n;
        if (ice) {
          r = 0.92; g = 0.95; b = 0.98;
        } else if (n < 0.48) {
          const deep = Math.min(1, (0.48 - n) * 3);
          r = p.baseColor.r * (1 - deep * 0.45);
          g = p.baseColor.g * (1 - deep * 0.3);
          b = p.baseColor.b;
        } else if (n < 0.53) {
          r = 0.76; g = 0.7; b = 0.5; // coast sand
        } else {
          const hi = Math.min(1, (n - 0.53) * 3.2);
          r = p.secondColor.r * (0.65 + 0.35 * hi) * 0.55 + 0.1;
          g = p.secondColor.g * (0.65 + 0.35 * hi) * 0.7 + 0.12;
          b = p.secondColor.b * (0.5 + 0.3 * hi) * 0.4 + 0.06;
        }
        // cloud deck: independent noise field, soft-thresholded
        const cf = cloudNoise!.fbm(x * 3.4 + 7.7, y * 3.4, z * 3.4, 4, 0.55, 2.1) * 0.5 + 0.5;
        const cov = Math.min(1, Math.max(0, (cf - (1 - (p.clouds ?? 0.45) * 0.9)) * 3.2));
        r = r + (0.97 - r) * cov;
        g = g + (0.97 - g) * cov;
        b = b + (0.99 - b) * cov;
      } else {
        const t = Math.min(1, Math.max(0, n * 1.4 - 0.2));
        r = p.baseColor.r + t * (p.secondColor.r - p.baseColor.r);
        g = p.baseColor.g + t * (p.secondColor.g - p.baseColor.g);
        b = p.baseColor.b + t * (p.secondColor.b - p.baseColor.b);
        if (style === 'gas') {
          // storm ovals: two seeded anticyclones brighten/tint locally
          const s1 = Math.exp(-(Math.pow((x - 0.32) * 3.4, 2) + Math.pow((y - 0.22) * 7, 2)));
          const s2 = Math.exp(-(Math.pow((x + 0.4) * 4.2, 2) + Math.pow((y + 0.4) * 8, 2)));
          r += s1 * 0.28 + s2 * 0.1;
          g += s1 * 0.12 + s2 * 0.1;
          b += s2 * 0.14;
        }
      }

      // craters: bowls with a light-facing rim highlight (rocky style)
      if (craters.length) {
        for (const cr of craters) {
          const dx3 = x - cr.x, dy3 = y - cr.y, dz3 = z - cr.z;
          const d = Math.hypot(dx3, dy3, dz3) / cr.r;
          if (d >= 1.15) continue;
          if (d < 0.8) {
            const floor = 1 - 0.48 * (1 - d / 0.8); // darker toward center
            r *= floor; g *= floor; b *= floor;
          } else if (d < 1.05) {
            // rim: bright on the lit side, dark on the far side
            const rimT = 1 - Math.abs(d - 0.925) / 0.125;
            const lit = (dx3 * L.x + dy3 * L.y) / (cr.r || 1);
            const boost = 1 + rimT * 0.55 * Math.max(-1, Math.min(1, lit * 2));
            r *= boost; g *= boost; b *= boost;
          }
        }
      }

      const diffuse = Math.max(0, x * L.x + y * L.y + z * L.z);
      const shade = 0.06 + 0.94 * Math.pow(diffuse, 1.1);
      r *= shade;
      g *= shade;
      b *= shade;

      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, r * 255 * cover);
      img.data[o + 1] = Math.min(255, g * 255 * cover);
      img.data[o + 2] = Math.min(255, b * 255 * cover);
      img.data[o + 3] = Math.round(255 * cover);
    }
  }
  ctx.putImageData(img, 0, 0);

  // atmosphere rim: drawn before the rings so the near-side rings pass in
  // front of the glow; 'screen' instead of additive so ring + atmosphere
  // overlap can't blow out to white
  if (p.atmosphereWidth > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const w = R * p.atmosphereWidth * 4;
    const g = ctx.createRadialGradient(c, c, Math.max(0, R - w * 0.4), c, c, R + w);
    g.addColorStop(0, css(p.atmosphereColor, 0));
    g.addColorStop(0.45, css(p.atmosphereColor, 0.35));
    g.addColorStop(0.75, css(p.atmosphereColor, 0.18));
    g.addColorStop(1, css(p.atmosphereColor, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // rings: each stackable set is drawn as concentric ellipse bands. The far
  // half (behind the ring's line of nodes) draws behind the disc + atmosphere
  // via destination-over onto the pixels putImageData left transparent; the
  // near half draws in front. Each set rotates/tilts independently.
  for (const rg of rings) {
    if (rg.opacity <= 0 || rg.outer <= rg.inner) continue;
    drawRingSet(ctx, size, R, rg);
  }

  return flattenOntoBlack(canvas);
}

/**
 * Draw one ring set with independent in-plane rotation + tilt, preserving the
 * two-pass occlusion: the context is rotated so the ring's line of nodes is
 * horizontal, then the top (far) half composites behind existing pixels and
 * the bottom (near) half in front.
 */
function drawRingSet(
  ctx: CanvasRenderingContext2D, size: number, R: number, rg: RingParams,
): void {
  const c = size / 2;
  const noise = new PerlinNoise(rg.bandSeed >>> 0);
  const squash = Math.max(0.06, Math.sin((rg.tiltDeg * Math.PI) / 180));
  const phi = (rg.rotationDeg * Math.PI) / 180;
  const steps = 42;
  const bandW = ((rg.outer - rg.inner) * R) / steps;
  const drawBands = () => {
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const radius = (rg.inner + t * (rg.outer - rg.inner)) * R;
      // seeded band structure: gaps + brightness variation over radius
      const band = noise.fbm(t * 5.2 + 17.3, 8.8, 0.5, 3, 0.5, 2.0) * 0.5 + 0.5;
      const alpha = rg.opacity * Math.max(0, band * 1.35 - 0.25);
      if (alpha <= 0.004) continue;
      ctx.strokeStyle = css(rg.color, Math.min(1, alpha));
      ctx.lineWidth = bandW * 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  // far half (rotated-frame top): behind the planet
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(phi);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.beginPath();
  ctx.rect(-size, -size, size * 2, size);
  ctx.clip();
  drawBands();
  ctx.restore();
  // near half (rotated-frame bottom): in front of the planet
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(phi);
  ctx.beginPath();
  ctx.rect(-size, 0, size * 2, size);
  ctx.clip();
  drawBands();
  ctx.restore();
}
