/**
 * Anomaly sprite generator: extreme / exotic objects that don't fit the
 * star, galaxy, nebula, or planet bakers — black holes, tidal disruption
 * events, multiples, novae/supernovae/kilonovae, quasars, obscured AGN tori,
 * magnetars, and pulsars. Dispatched by style like bakeGalaxyGen. Pure PCG:
 * canvas primitives + per-pixel fields, deterministic per seed (MSVC LCG /
 * Perlin). See docs/PCG-STELLAR-STYLES-PLAN.md §6.
 *
 * Additive-sprite caveat: baked sprites composite one/one, so a sprite can
 * only ADD light. "Dark" elements (a black hole's shadow, a torus silhouette)
 * only read against light the sprite itself provides — for a black hole that
 * genuinely occludes/lenses the starfield, the positional blackHoleLayer is
 * the tool. These bakers are for distant, self-lit decorative objects.
 */
import { kelvinToRgb } from '../core/blackbody';
import type { Rgba } from '../core/layers';
import { PerlinNoise } from '../core/perlin';
import { MsvcRng } from '../core/rng';
import { GEN_SIZE, cssRgba as css, makeCanvas } from './genCommon';
import { beamIntensity, dipoleRadius, geometricSeries } from './pcgMath';
import { CRITICAL_B, radiusAtPhi, slopeAtPhi, tracePlanar, type PlanarTrajectory } from './geodesic';
import { plummerRadius, sersicIntensity } from './profiles';

export type AnomalyStyle =
  | 'black-hole' | 'tde' | 'multiple' | 'nova' | 'supernova'
  | 'kilonova' | 'quasar' | 'smbh-torus' | 'magnetar' | 'pulsar';

export interface AnomalyGenParams {
  seed: number;
  style: AnomalyStyle;
  // black-hole / tde compact-object disc
  horizonRadius?: number;  // 0.05..0.16 shadow radius (fraction of sprite)
  discInner?: number;      // in horizon radii
  discOuter?: number;      // in horizon radii
  discKelvin?: number;     // disc temperature
  doppler?: number;        // 0..1 side-brightening
  tilt?: number;           // 55..85 disc tilt
  photonRing?: number;     // 0..1
  hat?: number;            // 0..1 far-side lensed image over the top
  // tde
  wraps?: number;          // 0.8..2.5 stream turns
  streamWidth?: number;
  starKelvin?: number;
  starSize?: number;
  hotspot?: number;
  // multiple
  count?: number;          // 2..3
  separation?: number;     // 0.15..0.4
  kelvinA?: number; kelvinB?: number; kelvinC?: number;
  sizeRatio?: number;
  contact?: number;        // 0..1 metaball bridge
  spikes?: number;
  circumbinaryRing?: number;
  // nova
  shellRadius?: number; shellAge?: number; streaks?: number; kelvin?: number;
  // supernova
  ejectaAmount?: number; rays?: number; filamentContrast?: number; coreBrightness?: number;
  // kilonova
  phase?: number; axisDeg?: number; torusTilt?: number; blueAmount?: number; redAmount?: number;
  // quasar
  jetLength?: number; jetAngleDeg?: number; jetWidth?: number; knots?: number;
  jetAsymmetry?: number; bend?: number; hostGlow?: number; coreKelvin?: number;
  // smbh-torus
  torusRadius?: number; torusThickness?: number; clumpiness?: number;
  coneAngle?: number; coneAmount?: number; jetAmount?: number;
  // magnetar
  lines?: number; loopScale?: number; twist?: number; hotspots?: number;
  // pulsar (neutron star)
  beamAngle?: number; beamLength?: number; beamWidthDeg?: number;
  misalignDeg?: number; hollowness?: number; windTorus?: number;
}

export const DEFAULT_ANOMALY: AnomalyGenParams = {
  seed: 12,
  style: 'black-hole',
  horizonRadius: 0.1, discInner: 2.2, discOuter: 6, discKelvin: 12000,
  doppler: 0.7, tilt: 75, photonRing: 1, hat: 0.7,
};

/** Style presets the UI applies on style change (mirrors NEBULA_STYLE_DEFAULTS). */
export const ANOMALY_STYLE_DEFAULTS: Record<AnomalyStyle, Partial<AnomalyGenParams>> = {
  'black-hole': { horizonRadius: 0.1, discInner: 2.2, discOuter: 6, discKelvin: 12000, doppler: 0.7, tilt: 75, photonRing: 1, hat: 0.7 },
  tde: { horizonRadius: 0.05, discInner: 2.2, discOuter: 3.2, discKelvin: 20000, doppler: 0.6, tilt: 70, photonRing: 0.7, hat: 0.2, wraps: 1.5, streamWidth: 6, starKelvin: 5200, starSize: 10, hotspot: 1 },
  multiple: { count: 2, separation: 0.28, kelvinA: 9500, kelvinB: 4200, kelvinC: 6000, sizeRatio: 0.6, contact: 0, spikes: 4, circumbinaryRing: 0 },
  nova: { shellRadius: 0.25, shellAge: 0.4, streaks: 0.5, kelvin: 8000, spikes: 5 },
  supernova: { shellRadius: 0.34, ejectaAmount: 0.7, rays: 16, filamentContrast: 1.4, coreBrightness: 1, kelvin: 9000 },
  kilonova: { phase: 0.35, axisDeg: 20, torusTilt: 65, blueAmount: 0.8, redAmount: 0.8, streaks: 0.6 },
  quasar: { jetLength: 0.42, jetAngleDeg: 20, jetWidth: 5, knots: 4, jetAsymmetry: 0.65, bend: 0.15, hostGlow: 0.4, coreKelvin: 16000 },
  'smbh-torus': { torusRadius: 0.26, torusThickness: 0.09, tilt: 45, clumpiness: 0.5, coneAngle: 42, coneAmount: 0.5, jetAmount: 0.5, coreKelvin: 18000 },
  magnetar: { lines: 6, loopScale: 0.14, axisDeg: 20, twist: 0.4, hotspots: 1, coreKelvin: 16000 },
  pulsar: { beamAngle: 55, beamLength: 0.45, beamWidthDeg: 9, misalignDeg: 25, hollowness: 0.6, windTorus: 0.4, coreKelvin: 22000 },
};

// ------------------------------------------------------------- primitives

/** Additive radial glow splat at (x,y). */
function addGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: Rgba, a = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(col, a));
  g.addColorStop(0.3, css(col, a * 0.5));
  g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** White-hot core with optional colored halo — the "point source" look. */
function addCore(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: Rgba, a = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.18, css(col, a * 0.85));
  g.addColorStop(0.5, css(col, a * 0.2));
  g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** One diffraction spike centered at (x,y). */
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

/** N diffraction spikes evenly spread over 180°. */
function addSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, length: number, angle = 45): void {
  for (let i = 0; i < count; i++) addSpike(ctx, x, y, angle + (i * 180) / count, length, 2.5, 0.9);
}

/** Write a float accumulation buffer (RGB, 0..) into the canvas, clamped. */
function writeAcc(ctx: CanvasRenderingContext2D, acc: Float32Array, size: number): void {
  const img = ctx.createImageData(size, size);
  for (let i = 0, o = 0; i < size * size; i++, o += 4) {
    img.data[o] = Math.min(255, acc[i * 3] * 255);
    img.data[o + 1] = Math.min(255, acc[i * 3 + 1] * 255);
    img.data[o + 2] = Math.min(255, acc[i * 3 + 2] * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Add a colored contribution to the accumulation buffer at pixel index i. */
function accAdd(acc: Float32Array, i: number, col: Rgba, v: number): void {
  acc[i * 3] += col.r * v;
  acc[i * 3 + 1] += col.g * v;
  acc[i * 3 + 2] += col.b * v;
}

// -------------------------------------------------------------- dispatch

export function bakeAnomalyGen(p: AnomalyGenParams): HTMLCanvasElement {
  switch (p.style) {
    case 'black-hole': return bakeBlackHole(p);
    case 'tde': return bakeTde(p);
    case 'multiple': return bakeMultiple(p);
    case 'nova': return bakeNova(p);
    case 'supernova': return bakeSupernova(p);
    case 'kilonova': return bakeKilonova(p);
    case 'quasar': return bakeQuasar(p);
    case 'smbh-torus': return bakeSmbhTorus(p);
    case 'magnetar': return bakeMagnetar(p);
    case 'pulsar': return bakePulsar(p);
  }
}

// ------------------------------------------- black hole (geodesic-traced)

/**
 * Geodesic black-hole bake: every pixel is a parallel camera ray traced
 * through the Schwarzschild metric (src/gen/geodesic.ts). Because parallel
 * rays share trajectories per impact parameter b, one planar trace per
 * (quantized) pixel radius is reused for the whole ring of pixels; each
 * pixel then intersects that r(phi) curve with the tilted disc plane
 * analytically. The far-side "hat", doubled disc images, shadow, and photon
 * ring all emerge from the tracing instead of being painted.
 *
 * Disc shading follows BlackHoleViz_v2: Novikov-Thorne-like temperature
 * T ~ r^-0.75 colored via kelvinToRgb, Keplerian Doppler with relativistic
 * beaming, gravitational redshift, and a radius-twisted FBM density for
 * differential-rotation streaks. All deterministic (seeded Perlin only).
 */
function bakeBlackHole(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  // the legacy horizonRadius param is the SHADOW radius (fraction of sprite);
  // physically the shadow is the critical impact parameter, so 1 rs in px is:
  const shadowPx = size * (p.horizonRadius ?? 0.1);
  const rsPx = shadowPx / CRITICAL_B;
  // disc radii params are in shadow radii (legacy semantics) -> rs units
  const rIn = Math.max(2.2, (p.discInner ?? 2.2) * CRITICAL_B);
  const rOut = Math.max(rIn + 1.5, (p.discOuter ?? 6) * CRITICAL_B);
  const tiltR = ((p.tilt ?? 75) * Math.PI) / 180;
  const dop = p.doppler ?? 0.7;
  const hat = p.hat ?? 0.7;
  const Tref = p.discKelvin ?? 12000;
  const noise = new PerlinNoise(p.seed >>> 0);
  const acc = new Float32Array(size * size * 3);

  // disc plane: face-on normal +z tilted around the x axis; with
  // n = (0, sin t, cos t) the near side projects to the lower half (canvas
  // y down), matching the old painter's convention
  const sinT = Math.sin(tiltR), cosT = Math.cos(tiltR);
  const nx = 0, ny = sinT, nz = cosT;

  const Z0 = 60;
  const bMax = rOut * 1.06;
  const trajCache = new Map<number, PlanarTrajectory>();
  const trajFor = (b: number): PlanarTrajectory => {
    // quantize to half-pixel so a few hundred traces serve every pixel
    const key = Math.round(b * rsPx * 2);
    let t = trajCache.get(key);
    if (!t) {
      t = tracePlanar(key / (rsPx * 2), { r0: Z0, phiStep: Math.PI / 512 });
      trajCache.set(key, t);
    }
    return t;
  };

  const inEnv = (rho: number): number => {
    const a = Math.min(1, Math.max(0, (rho - rIn * 0.96) / (rIn * 0.12)));
    const b2 = 1 - Math.min(1, Math.max(0, (rho - rOut * 0.82) / (rOut * 0.18)));
    return a * a * (3 - 2 * a) * b2 * b2 * (3 - 2 * b2);
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const X = (px - c) / rsPx;
      const Y = (py - c) / rsPx;
      const b = Math.hypot(X, Y);
      if (b > bMax || b < 1e-4) continue;

      const traj = trajFor(b);

      // orbital-plane basis in world space for THIS pixel's ray:
      // origin o = (X, Y, -Z0), direction d = (0, 0, 1)
      const oLen = Math.hypot(X, Y, Z0);
      const rx = X / oLen, ry = Y / oLen, rz = -Z0 / oLen; // radial axis
      // normal = o x d = (Y, -X, 0) normalized
      const nl = Math.hypot(Y, X);
      const nxx = Y / nl, nyy = -X / nl;
      // tangential = normal x radial
      const tx = nyy * rz, ty = -nxx * rz, tz = nxx * ry - nyy * rx;

      // disc-plane crossings: dot(P(phi), n) = r * A * cos(phi - phi0)
      const an = rx * nx + ry * ny + rz * nz;
      const tn = tx * nx + ty * ny + tz * nz;
      const A = Math.hypot(an, tn);
      if (A < 1e-6) continue; // grazing the disc plane edge-on
      const phi0 = Math.atan2(tn, an);

      let light = 1; // transmission through successive disc passes
      for (let k = -2; k <= 8 && light > 0.02; k++) {
        const phiK = phi0 + Math.PI / 2 + k * Math.PI;
        if (phiK <= 0.01 || phiK >= traj.phiEnd) continue;
        const rho = radiusAtPhi(traj, phiK);
        if (Number.isNaN(rho) || rho < rIn * 0.9 || rho > rOut * 1.05) continue;
        const env = inEnv(rho);
        if (env <= 0.002) continue;

        // 3D crossing point and the photon's travel direction there
        const cph = Math.cos(phiK), sph = Math.sin(phiK);
        const qx = rx * rho * cph + tx * rho * sph;
        const qy = ry * rho * cph + ty * rho * sph;
        const qz = rz * rho * cph + tz * rho * sph;
        const rp = slopeAtPhi(traj, phiK); // dr/dphi
        let vx = rx * (rp * cph - rho * sph) + tx * (rp * sph + rho * cph);
        let vy = ry * (rp * cph - rho * sph) + ty * (rp * sph + rho * cph);
        let vz = rz * (rp * cph - rho * sph) + tz * (rp * sph + rho * cph);
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl; vy /= vl; vz /= vl;

        // Keplerian material velocity (prograde around n)
        let ox = ny * qz - nz * qy;
        let oy = nz * qx - nx * qz;
        let oz = nx * qy - ny * qx;
        const ol = Math.hypot(ox, oy, oz) || 1;
        ox /= ol; oy /= ol; oz /= ol;
        const vK = Math.min(0.6, Math.sqrt(0.5 / Math.max(rho - 1, 1)));
        // photon direction TOWARD the observer is -v (we trace backward)
        const mu = -(ox * vx + oy * vy + oz * vz);
        const gamma = 1 / Math.sqrt(1 - vK * vK);
        const delta = 1 / (gamma * (1 - vK * mu));
        const dEff = 1 + (delta - 1) * dop; // doppler param scales the effect

        // gravitational redshift
        const g = Math.sqrt(Math.max(0.05, 1 - 1 / rho));

        // Doppler color normalized to peak at Tref on the approaching side,
        // falling toward ~Tref/10 on the receding side at full Doppler
        // (matches the positional layer's lens shader)
        const dMax = 1 / (gamma * (1 - vK));
        const shift = Math.pow(Math.max(delta / dMax, 1e-3), 1 + 2.2 * dop);
        const T = Tref * Math.pow(rIn / rho, 0.75);
        const Tobs = Math.min(39000, Math.max(1200, T * shift * g));
        const col = kelvinToRgb(Tobs);

        // radius-twisted density noise (differential-rotation streaks)
        const du = qx; // disc basis u1 = (1,0,0)
        const dv = qy * cosT - qz * sinT; // u2 = (0, cos t, -sin t)
        const thTw = Math.atan2(dv, du) + 2.6 * (rho - rIn) / (rOut - rIn);
        const kr = 1.4 + rho * 0.16;
        const fb = noise.fbm(
          Math.cos(thTw) * kr, Math.sin(thTw) * kr, 0.5, 4, 0.5, 2) * 0.5 + 0.5;
        const density = 0.22 + 0.95 * Math.pow(fb, 1.7);

        // Stefan-Boltzmann-ish radial falloff, softened for visibility
        const radial = Math.pow(rIn / rho, 2.2);
        const inten = 0.62 * env * density * radial
          * Math.pow(dEff, 3) * g * g * light;
        accAdd(acc, py * size + px, { r: col.r, g: col.g, b: col.b, a: 1 }, inten);

        // later crossings are the lensed far-side / higher-order images; the
        // legacy "hat" param now scales how visible they are
        light *= 0.55 * (k >= 0 ? (0.25 + 0.75 * hat) : 1);
      }
    }
  }

  // synthetic photon-ring accent + faint ambient; the true ring imagery is
  // emergent, this only sweetens the unresolved n>=2 images at the exact
  // critical radius
  const ringAmt = (p.photonRing ?? 1) * 0.8;
  const ringCol = { r: 1, g: 0.95, b: 0.82, a: 1 };
  const ambient = { r: 0.5, g: 0.6, b: 1, a: 1 };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const r = Math.hypot(px - c, py - c);
      const i = py * size + px;
      if (ringAmt > 0) {
        const sig = Math.max(1.1, 0.032 * shadowPx);
        accAdd(acc, i, ringCol, ringAmt * Math.exp(-Math.pow((r - shadowPx) / sig, 2)));
      }
      // ambient glow outside the shadow only
      const shade = Math.min(1, Math.max(0, (r - shadowPx * 0.9) / (shadowPx * 0.2)));
      accAdd(acc, i, ambient, 0.05 * Math.exp(-r / (2.4 * shadowPx)) * shade);
    }
  }

  // soft Reinhard-style shoulder: hard clipping at 1.0 was flattening the
  // Doppler contrast and blackbody hues into uniform white
  // small floor cut keeps the tonemap from lifting near-black regions into a
  // wide fog halo when the sprite is magnified on a quad
  for (let i = 0; i < acc.length; i++) {
    const a = acc[i];
    acc[i] = Math.max(0, (a * 1.55) / (1 + a) - 0.012);
  }

  writeAcc(ctx, acc, size);
  return canvas;
}

// ---------------------------------------------------------------------- tde

function bakeTde(p: AnomalyGenParams): HTMLCanvasElement {
  // base: compact hot black hole
  const canvas = bakeBlackHole({ ...p, hat: (p.hat ?? 0.2) });
  const ctx = canvas.getContext('2d')!;
  const size = GEN_SIZE;
  const c = size / 2;
  const Rh = size * (p.horizonRadius ?? 0.05);
  const rIn = (p.discInner ?? 2.2) * Rh;
  const rStar = size * 0.36;
  const wraps = p.wraps ?? 1.5;
  const rng = new MsvcRng((p.seed + 0x7de) >>> 0);
  const thetaMax = wraps * Math.PI * 2;
  const k = Math.log(rStar / Math.max(rIn, 1)) / thetaMax;
  const paDeg = 0;
  const cosPa = Math.cos(paDeg), sinPa = Math.sin(paDeg);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const N = 420;
  const sigma0 = p.streamWidth ?? 6;
  for (let n = 0; n < N; n++) {
    const th = (n / N) * thetaMax;
    const r = rStar * Math.exp(-k * th);
    const frac = r / rStar;
    const sig = sigma0 * (0.25 + 0.75 * frac);
    // perpendicular jitter
    const jx = (rng.unit() - 0.5) * 2 * sig;
    const jy = (rng.unit() - 0.5) * 2 * sig;
    const bx = r * Math.cos(th) + jx;
    const by = r * Math.sin(th) + jy;
    const x = c + bx * cosPa - by * sinPa;
    const y = c + bx * sinPa + by * cosPa;
    const kel = 4500 + (1 - frac) * (18000 - 4500);
    const col = kelvinToRgb(kel);
    const a = 0.06 + 0.14 * (1 - frac);
    addGlow(ctx, x, y, sig * 1.8, col, a);
  }
  // self-intersection hotspot near θ ≈ 2π (wrap 1 meets wrap 2)
  if ((p.hotspot ?? 1) > 0 && wraps > 1) {
    const th = Math.PI * 2;
    const r = rStar * Math.exp(-k * th);
    const x = c + r * Math.cos(th) * cosPa - r * Math.sin(th) * sinPa;
    const y = c + r * Math.cos(th) * sinPa + r * Math.sin(th) * cosPa;
    addCore(ctx, x, y, 14, { r: 0.8, g: 0.9, b: 1, a: 1 }, (p.hotspot ?? 1));
  }
  // the victim star: teardrop = metaball chain along the first 60° of spiral
  const starK = kelvinToRgb(p.starKelvin ?? 5200);
  const sSize = p.starSize ?? 10;
  for (let m = 0; m < 7; m++) {
    const th = (m / 7) * (Math.PI / 3);
    const r = rStar * Math.exp(-k * th);
    const x = c + r * Math.cos(th);
    const y = c + r * Math.sin(th);
    addCore(ctx, x, y, sSize * (1 - m * 0.1), starK, 0.9 - m * 0.08);
  }
  // faint unbound tidal fan
  for (let f = 0; f < 100; f++) {
    const u = rng.unit();
    const rr = rStar * (0.6 + 0.6 * u);
    const th = thetaMax * (0.7 + 0.3 * rng.unit()) + (rng.unit() - 0.5) * 0.9;
    const x = c + rr * Math.cos(th);
    const y = c + rr * Math.sin(th);
    addGlow(ctx, x, y, 2.5, kelvinToRgb(6000), 0.05);
  }
  ctx.restore();
  return canvas;
}

// ----------------------------------------------------------------- multiple

function bakeMultiple(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const count = Math.min(3, Math.max(2, Math.round(p.count ?? 2)));
  const sep = (p.separation ?? 0.28) * size;
  const kelvins = [p.kelvinA ?? 9500, p.kelvinB ?? 4200, p.kelvinC ?? 6000];
  const sizeRatio = p.sizeRatio ?? 0.6;
  const contact = p.contact ?? 0;

  // positions on a shared horizontal ellipse (hierarchical for trinary)
  const stars: { x: number; y: number; r: number; col: Rgba }[] = [];
  if (count === 2) {
    stars.push({ x: c - sep / 2, y: c, r: 26, col: kelvinToRgb(kelvins[0]) });
    stars.push({ x: c + sep / 2, y: c, r: 26 * sizeRatio + 8, col: kelvinToRgb(kelvins[1]) });
  } else {
    stars.push({ x: c - sep * 0.35, y: c - sep * 0.12, r: 24, col: kelvinToRgb(kelvins[0]) });
    stars.push({ x: c - sep * 0.05, y: c + sep * 0.1, r: 22, col: kelvinToRgb(kelvins[1]) });
    stars.push({ x: c + sep * 0.55, y: c - sep * 0.05, r: 24 * sizeRatio + 6, col: kelvinToRgb(kelvins[2]) });
  }

  // contact metaball bridge: brighten pixels where the summed field crosses a
  // threshold along the inter-star band
  if (contact > 0) {
    const acc = new Float32Array(size * size * 3);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        let f = 0;
        let cr = 0, cg = 0, cb = 0;
        for (const s of stars) {
          const d2 = (px - s.x) ** 2 + (py - s.y) ** 2;
          const sig = s.r * (0.9 + contact * 0.8);
          const w = Math.exp(-d2 / (sig * sig));
          f += w; cr += s.col.r * w; cg += s.col.g * w; cb += s.col.b * w;
        }
        const thr = 0.55 - contact * 0.25;
        if (f > thr) {
          const v = Math.min(1.2, (f - thr) * 2.2);
          const i = py * size + px;
          acc[i * 3] += (cr / Math.max(1e-3, f)) * v;
          acc[i * 3 + 1] += (cg / Math.max(1e-3, f)) * v;
          acc[i * 3 + 2] += (cb / Math.max(1e-3, f)) * v;
        }
      }
    }
    writeAcc(ctx, acc, size);
  }

  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    // mutual illumination: tint halo slightly toward the other stars
    addCore(ctx, s.x, s.y, s.r, s.col, 1);
    addGlow(ctx, s.x, s.y, s.r * 2.4, s.col, 0.4);
    if ((p.spikes ?? 4) > 0) addSpikes(ctx, s.x, s.y, p.spikes ?? 4, s.r * 2.6);
  }
  // circumbinary dust ring around the barycenter
  if ((p.circumbinaryRing ?? 0) > 0) {
    drawTiltedRing(ctx, c, c, sep * 1.4, sep * 1.4 * 0.45, 0, { r: 0.75, g: 0.62, b: 0.5, a: 1 }, 0.25 * (p.circumbinaryRing ?? 0), new PerlinNoise((p.seed + 3) >>> 0));
  }
  return canvas;
}

// --------------------------------------------------------------------- nova

function bakeNova(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const age = p.shellAge ?? 0.4;
  const Rs = size * (p.shellRadius ?? 0.25) * (0.6 + 0.8 * age);
  const coreCol = kelvinToRgb(p.kelvin ?? 8000);

  ctx.globalCompositeOperation = 'lighter';
  // thin young shell: two-tone (Ha red outer, pale yellow inner), wobbled
  const acc = new Float32Array(size * size * 3);
  const outerCol = { r: 1, g: 0.3, b: 0.22, a: 1 };
  const innerCol = { r: 1, g: 0.95, b: 0.7, a: 1 };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - c, dy = py - c;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const wob = 1 + 0.05 * noise.fbm(Math.cos(th) * 2 + 5, Math.sin(th) * 2, 0.5, 2, 0.5, 2);
      const rr = Rs * wob;
      const shell = Math.exp(-Math.pow((r - rr) / (0.04 * Rs + 3), 2)) * (1 - 0.5 * age);
      accAdd(acc, py * size + px, outerCol, shell * 0.5);
      accAdd(acc, py * size + px, innerCol, Math.exp(-Math.pow((r - rr * 0.9) / (0.05 * Rs + 3), 2)) * shell * 0.6);
    }
  }
  writeAcc(ctx, acc, size);
  ctx.globalCompositeOperation = 'lighter';
  // previous-outburst echo ring
  addRing(ctx, c, c, Rs * 0.6, outerCol, 0.12 * (1 - age));
  // ejecta streaks
  if ((p.streaks ?? 0.5) > 0) {
    const rng = new MsvcRng((p.seed + 9) >>> 0);
    const n = Math.round(8 + 8 * (p.streaks ?? 0.5));
    for (let i = 0; i < n; i++) {
      const a = rng.unit() * Math.PI * 2;
      if (noise.fbm(Math.cos(a) * 4, Math.sin(a) * 4, 0.5, 2, 0.5, 2) < 0) continue;
      addSpike(ctx, c, c, (a * 180) / Math.PI, Rs, 2, 0.15);
    }
  }
  // brilliant core + spikes
  addCore(ctx, c, c, size * 0.06, coreCol, 1);
  if ((p.spikes ?? 5) > 0) addSpikes(ctx, c, c, p.spikes ?? 5, size * 0.2);
  return canvas;
}

// ---------------------------------------------------------------- supernova

function bakeSupernova(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const rng = new MsvcRng((p.seed + 0x5a) >>> 0);
  const Rs = size * (p.shellRadius ?? 0.34);
  const acc = new Float32Array(size * size * 3);
  const haCol = { r: 0.95, g: 0.28, b: 0.2, a: 1 };
  const oiiiCol = { r: 0.25, g: 0.75, b: 0.7, a: 1 };
  const shockCol = { r: 0.7, g: 0.82, b: 1, a: 1 };
  const contrast = p.filamentContrast ?? 1.4;
  const ejecta = p.ejectaAmount ?? 0.7;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - c, dy = py - c;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const i = py * size + px;
      // outer shock: limb-brightened thin bubble (path-length ~ 1/sqrt(1-(r/Rs)^2))
      const wob = 1 + 0.06 * noise.fbm(Math.cos(th) * 2.4 + 3, Math.sin(th) * 2.4, 0.5, 2, 0.5, 2);
      const Rw = Rs * wob;
      // limb-brightened bubble, evaluated on BOTH sides of the rim: the
      // gaussian tail antialiases the outer shock (no hard edge cut)
      if (r < Rw * 1.35) {
        const path = r < Rw ? 1 / Math.sqrt(Math.max(0.02, 1 - (r / Rw) ** 2)) : 2.2;
        const shell = Math.min(2.2, path) * Math.exp(-Math.pow((r - Rw) / (0.06 * Rs), 2));
        accAdd(acc, i, shockCol, shell * 0.5);
      }
      // inner clumpy ejecta filaments (ridged noise), masked by a mid-radius ring
      const mask = Math.exp(-Math.pow((r - 0.55 * Rs) / (0.18 * Rs), 2));
      if (mask > 0.01) {
        const fil = Math.abs(noise.fbm(dx * 0.03 + 11, dy * 0.03, 0.5, 4, 0.5, 2.2));
        const f = Math.pow(Math.max(0, 1 - fil * 2.6), contrast) * mask * ejecta;
        const hue = noise.fbm(dx * 0.02 + 40, dy * 0.02 + 7, 0.5, 2, 0.5, 2) * 0.5 + 0.5;
        const col = { r: haCol.r + hue * (oiiiCol.r - haCol.r), g: haCol.g + hue * (oiiiCol.g - haCol.g), b: haCol.b + hue * (oiiiCol.b - haCol.b), a: 1 };
        accAdd(acc, i, col, f * 1.4);
      }
    }
  }
  writeAcc(ctx, acc, size);

  ctx.globalCompositeOperation = 'lighter';
  // reverse-shock knots
  const nk = 60;
  for (let i = 0; i < nk; i++) {
    const rr = plummerRadius(rng.unit(), Rs * 0.25) % Rs;
    const a = rng.unit() * Math.PI * 2;
    addGlow(ctx, c + rr * Math.cos(a), c + rr * Math.sin(a), 3, { r: 1, g: 0.85, b: 0.7, a: 1 }, 0.25);
  }
  // radial rays through the shell
  const rays = Math.round(p.rays ?? 16);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rng.unit() * 0.15;
    if (noise.fbm(Math.cos(a) * 3, Math.sin(a) * 3, 0.5, 2, 0.5, 2) < -0.1) continue;
    addSpike(ctx, c, c, (a * 180) / Math.PI, Rs * 1.05, 2, 0.12);
  }
  // blinding core + afterglow + spikes
  const afterK = kelvinToRgb(p.kelvin ?? 9000);
  addGlow(ctx, c, c, size * 0.4, afterK, 0.06 * (p.coreBrightness ?? 1) * sersicIntensity(1, 1, 1));
  addCore(ctx, c, c, size * 0.055, afterK, p.coreBrightness ?? 1);
  addSpikes(ctx, c, c, 8, size * 0.26);
  return canvas;
}

// ----------------------------------------------------------------- kilonova

function bakeKilonova(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const phase = p.phase ?? 0.35;
  const axis = ((p.axisDeg ?? 20) * Math.PI) / 180;
  const acc = new Float32Array(size * size * 3);
  const blue = kelvinToRgb(12000);
  const redK = kelvinToRgb(2600);
  const red = { r: redK.r * 0.5 + 0.6 * 0.5, g: redK.g * 0.5 + 0.15 * 0.5, b: redK.b * 0.5 + 0.1 * 0.5, a: 1 };
  const torusTilt = ((p.torusTilt ?? 65) * Math.PI) / 180;
  const cosTt = Math.max(0.15, Math.cos(torusTilt));
  const Rt = size * (0.12 + 0.25 * phase);

  const ca = Math.cos(axis), sa = Math.sin(axis);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - c, y = py - c;
      const i = py * size + px;
      // blue polar lobes: two broad elongated gaussians along ±axis
      const la = x * sa + y * (-ca); // along axis
      const da = x * ca + y * sa;    // perpendicular
      const bl = (p.blueAmount ?? 0.8) * (1 - 0.7 * phase);
      const lobe = beamIntensity(Math.abs(la), da, size * 0.09, 0, size * 0.35) * bl;
      accAdd(acc, i, blue, lobe * 0.9);
      // red equatorial torus (tilted annulus), clumped
      const xd = x, yd = y / cosTt;
      const rd = Math.hypot(xd, yd);
      const tor = Math.exp(-Math.pow((rd - Rt) / (0.4 * Rt), 2)) * (0.3 + 0.7 * phase) * (p.redAmount ?? 0.8);
      const clump = 0.6 + 0.4 * (noise.fbm(xd * 0.02 + 5, yd * 0.02, 0.5, 3, 0.5, 2) * 0.5 + 0.5);
      accAdd(acc, i, red, tor * clump * 0.8);
    }
  }
  writeAcc(ctx, acc, size);

  ctx.globalCompositeOperation = 'lighter';
  // fast radial streaks through the blue lobes only
  if ((p.streaks ?? 0.6) > 0) {
    const rng = new MsvcRng((p.seed + 4) >>> 0);
    const n = Math.round(12 + 12 * (p.streaks ?? 0.6));
    for (let i = 0; i < n; i++) {
      const spread = 0.5;
      const a = axis + Math.PI / 2 + (rng.unit() - 0.5) * spread + (rng.unit() < 0.5 ? 0 : Math.PI);
      addSpike(ctx, c, c, (a * 180) / Math.PI, size * 0.3, 1.5, 0.12 * (1 - 0.6 * phase));
    }
  }
  // intense white-blue core
  addCore(ctx, c, c, size * 0.05, { r: 0.8, g: 0.9, b: 1, a: 1 }, 1 - 0.5 * phase);
  return canvas;
}

// ------------------------------------------------------------------- quasar

function bakeQuasar(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const acc = new Float32Array(size * size * 3);
  const angle = ((p.jetAngleDeg ?? 20) * Math.PI) / 180;
  const L = size * (p.jetLength ?? 0.42);
  const w0 = p.jetWidth ?? 5;
  const wSlope = 0.06;
  const asym = p.jetAsymmetry ?? 0.65;
  const bend = p.bend ?? 0.15;
  const knots = Math.round(p.knots ?? 4);
  const jetCol = { r: 0.6, g: 0.75, b: 1, a: 1 };
  const knotCol = { r: 0.8, g: 0.88, b: 1, a: 1 };

  // host galaxy Sérsic smudge
  const hostGlow = p.hostGlow ?? 0.4;
  const host = { r: 0.9, g: 0.78, b: 0.55, a: 1 };
  const Re = 0.3 * size;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // knot positions along the jet (geometric spacing toward the end)
  const knotL = geometricSeries(L * Math.pow(1.6, -(knots - 1)), 1.6, knots);
  const rng = new MsvcRng((p.seed + 0x9) >>> 0);
  const knotAmp = knotL.map(() => 0.5 + rng.unit());

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - c, y = py - c;
      const i = py * size + px;
      if (hostGlow > 0) {
        accAdd(acc, i, host, hostGlow * 0.12 * sersicIntensity(Math.hypot(x, y), Re, 1));
      }
      // two jets along ±axis; project onto axis (la) and perpendicular (da)
      for (const sign of [1, -1]) {
        const la = (x * ca + y * sa) * sign;
        let da = -x * sa + y * ca;
        // S-bend offset
        if (la > 0) da -= bend * Math.sin((Math.PI * la) / L) * (w0 + wSlope * la);
        let inten = beamIntensity(la, da, w0, wSlope, L);
        // knot brightening
        for (let kk = 0; kk < knotL.length; kk++) {
          inten *= 1 + knotAmp[kk] * Math.exp(-Math.pow((la - knotL[kk]) / (0.05 * L + 4), 2));
        }
        const bright = sign === 1 ? 1 : (1 - asym);
        accAdd(acc, i, jetCol, inten * 0.9 * bright);
      }
    }
  }
  writeAcc(ctx, acc, size);

  ctx.globalCompositeOperation = 'lighter';
  // terminal hotspots + lobes at jet ends
  for (const sign of [1, -1]) {
    const ex = c + ca * L * sign;
    const ey = c + sa * L * sign;
    const bright = sign === 1 ? 1 : (1 - asym);
    addGlow(ctx, ex, ey, 0.22 * L, knotCol, 0.1 * bright);      // lobe cocoon
    addCore(ctx, ex, ey, 10, knotCol, 0.8 * bright);            // hotspot
  }
  // knot cores along the jet
  for (const sign of [1, -1]) {
    const bright = sign === 1 ? 1 : (1 - asym);
    for (let kk = 0; kk < knotL.length; kk++) {
      const lx = c + ca * knotL[kk] * sign;
      const ly = c + sa * knotL[kk] * sign;
      addGlow(ctx, lx, ly, 6, knotCol, 0.3 * knotAmp[kk] * bright);
    }
  }
  // blazing core
  const coreK = kelvinToRgb(p.coreKelvin ?? 16000);
  addGlow(ctx, c, c, size * 0.35, coreK, 0.1);
  addCore(ctx, c, c, size * 0.05, coreK, 1);
  addSpikes(ctx, c, c, 4, size * 0.24);
  return canvas;
}

// --------------------------------------------------------------- smbh-torus

function bakeSmbhTorus(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const tilt = ((p.tilt ?? 45) * Math.PI) / 180;
  const sinT = Math.max(0.2, Math.sin(tilt));
  const Rt = size * (p.torusRadius ?? 0.26);
  const wt = size * (p.torusThickness ?? 0.09);
  const clump = p.clumpiness ?? 0.5;
  const coreK = kelvinToRgb(p.coreKelvin ?? 18000);
  const coneCol = { r: 0.25, g: 0.8, b: 0.75, a: 1 };
  const innerRim = kelvinToRgb(2200);          // hot dust lit by the core
  const outerBrown = { r: 0.25, g: 0.16, b: 0.1, a: 1 };
  const coneHalf = ((p.coneAngle ?? 42) * Math.PI) / 180;
  const coneAmt = p.coneAmount ?? 0.5;

  // one accumulation buffer: ionization cones + dusty torus doughnut
  const acc = new Float32Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - c, y = py - c;
      const i = py * size + px;
      // vertical bicone ionization glow (perpendicular to the torus plane)
      if (coneAmt > 0) {
        const fromPole = Math.abs(Math.PI / 2 - Math.atan2(Math.abs(y), Math.abs(x)));
        if (fromPole < coneHalf) {
          const r = Math.hypot(x, y);
          const v = coneAmt * 0.16 * Math.exp(-r / (size * 0.32)) * (1 - fromPole / coneHalf);
          accAdd(acc, i, coneCol, v);
        }
      }
      // torus doughnut: an elliptical dust ring in the tilted disc plane
      const xd = x, yd = y / sinT;
      const rdisc = Math.hypot(xd, yd);
      const tube = Math.exp(-Math.pow((rdisc - Rt) / wt, 2))
        * (1 + clump * noise.fbm(x * 0.03 + 2, y * 0.03, 0.5, 3, 0.5, 2));
      if (tube > 0.02) {
        // inner rim (facing the core) reads as warm lit dust, outer as brown
        const litMix = Math.max(0, Math.min(1, (Rt - rdisc) / wt * 0.7 + 0.5));
        const col = {
          r: outerBrown.r + litMix * (innerRim.r - outerBrown.r),
          g: outerBrown.g + litMix * (innerRim.g - outerBrown.g),
          b: outerBrown.b + litMix * (innerRim.b - outerBrown.b),
          a: 1,
        };
        // near (bottom) rim is closer and brighter than the far (top) rim,
        // smoothly across the midline so there's no horizontal seam
        const near = 1 + 0.3 * Math.tanh(y / (0.6 * wt));
        accAdd(acc, i, col, tube * 1.3 * near);
      }
    }
  }
  writeAcc(ctx, acc, size);

  ctx.globalCompositeOperation = 'lighter';
  // polar jets inside the cones
  if ((p.jetAmount ?? 0.5) > 0) {
    addSpike(ctx, c, c, 90, size * 0.42, 4, 0.2 * (p.jetAmount ?? 0.5));
  }
  // bright core peeking through the torus hole
  addGlow(ctx, c, c, size * 0.14, coreK, 0.45);
  addCore(ctx, c, c, size * 0.04, coreK, 1);
  return canvas;
}

// ----------------------------------------------------------------- magnetar

function bakeMagnetar(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const axis = ((p.axisDeg ?? 20) * Math.PI) / 180;
  const lines = Math.round(p.lines ?? 6);
  const L0 = size * (p.loopScale ?? 0.14);
  const twist = p.twist ?? 0.4;
  const shells = geometricSeries(L0, 1.45, lines);
  const teal = { r: 0.3, g: 0.9, b: 0.8, a: 1 };
  const violet = { r: 0.6, g: 0.4, b: 1, a: 1 };
  const ca = Math.cos(axis), sa = Math.sin(axis);

  ctx.globalCompositeOperation = 'lighter';
  // dipole loops r(θ) = L·sin²θ rendered as DUSTY NEBULAR SHELLS, not wire
  // strokes: soft overlapping glow stamps march along each loop, with
  // noise-gated patchiness so the loops read like edge-on gas shells
  for (let s = 0; s < shells.length; s++) {
    const L = shells[s];
    const tmix = s / Math.max(1, shells.length - 1);
    const col = { r: teal.r + tmix * (violet.r - teal.r), g: teal.g + tmix * (violet.g - teal.g), b: teal.b + tmix * (violet.b - teal.b), a: 1 };
    for (const flip of [1, -1]) {
      const steps = 56;
      for (let ti = 0; ti <= steps; ti++) {
        const th = 0.22 + (ti / steps) * (Math.PI - 0.44);
        let r = dipoleRadius(L, th);
        r += noise.fbm(th * 2, s * 3, 0.5, 2, 0.5, 2) * twist * 0.06 * L;
        const mx = r * Math.sin(th) * flip;
        const my = r * Math.cos(th);
        const x = c + mx * ca - my * sa;
        const y = c + mx * sa + my * ca;
        // patchy density along the loop — dust clumps, gaps between them
        const dust = Math.max(0, noise.fbm(th * 3.1 + s * 5.7, flip * 2.3, 0.5, 3, 0.5, 2) * 0.9 + 0.55);
        // shells widen toward the loop top (edge-on shell look)
        const w = Math.max(3, L * (0.05 + 0.06 * Math.sin(th)));
        const a = 0.05 * dust * (1 - 0.35 * tmix);
        if (a <= 0.004) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, w);
        g.addColorStop(0, css(col, a));
        g.addColorStop(1, css(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - w, y - w, w * 2, w * 2);
      }
    }
  }
  // loop-top hotspots
  const hs = Math.round(p.hotspots ?? 1);
  const rng = new MsvcRng((p.seed + 7) >>> 0);
  for (let i = 0; i < hs; i++) {
    const s = Math.floor(rng.unit() * shells.length);
    const L = shells[s];
    const r = dipoleRadius(L, Math.PI / 2);
    const flip = rng.unit() < 0.5 ? 1 : -1;
    const mx = r * flip;
    const x = c + mx * ca;
    const y = c + mx * sa;
    addGlow(ctx, x, y, 10, { r: 0.8, g: 0.95, b: 1, a: 1 }, 0.6);
  }
  // fierce white-violet core + polar caps
  addCore(ctx, c, c, size * 0.045, { r: 0.85, g: 0.8, b: 1, a: 1 }, 1);
  addGlow(ctx, c, c, size * 0.12, violet, 0.4);
  return canvas;
}

// ------------------------------------------------------------------- pulsar

function bakePulsar(p: AnomalyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const noise = new PerlinNoise(p.seed >>> 0);
  const acc = new Float32Array(size * size * 3);
  const beamAngle = ((p.beamAngle ?? 55) * Math.PI) / 180;
  const L = size * (p.beamLength ?? 0.45);
  const w0 = 4;
  const wSlope = Math.tan(((p.beamWidthDeg ?? 9) * Math.PI) / 180);
  const hollow = p.hollowness ?? 0.6;
  const beamCol = kelvinToRgb(20000);
  const ca = Math.cos(beamAngle), sa = Math.sin(beamAngle);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - c, y = py - c;
      const i = py * size + px;
      for (const sign of [1, -1]) {
        const la = (x * ca + y * sa) * sign;
        const da = -x * sa + y * ca;
        let inten = beamIntensity(la, da, w0, wSlope, L, hollow);
        // faint internal striations
        inten *= 0.85 + 0.15 * (noise.fbm(la * 0.06, da * 0.1, 0.5, 2, 0.5, 2) * 0.5 + 0.5);
        accAdd(acc, i, beamCol, inten * 1.1);
        // time-averaged sweep glow (broad, faint)
        accAdd(acc, i, beamCol, beamIntensity(la, da, w0 * 2, wSlope * 2, L) * 0.18);
      }
    }
  }
  writeAcc(ctx, acc, size);

  ctx.globalCompositeOperation = 'lighter';
  // wind torus (Crab-like) perpendicular-ish
  if ((p.windTorus ?? 0.4) > 0) {
    const noiseR = new PerlinNoise((p.seed + 2) >>> 0);
    drawTiltedRing(ctx, c, c, size * 0.18, size * 0.18 * 0.4, 20, { r: 0.4, g: 0.9, b: 0.95, a: 1 }, 0.2 * (p.windTorus ?? 0.4), noiseR);
    drawTiltedRing(ctx, c, c, size * 0.11, size * 0.11 * 0.4, 20, { r: 0.5, g: 0.95, b: 1, a: 1 }, 0.12 * (p.windTorus ?? 0.4), noiseR);
  }
  // (the stroked spin-axis line + spin-plane ellipse were wire-frame
  // artifacts at sprite scale — removed per feedback; the beams + torus
  // carry the identity)
  // the neutron-star point itself
  addCore(ctx, c, c, size * 0.03, kelvinToRgb(p.coreKelvin ?? 22000), 1);
  return canvas;
}

// ---------------------------------------------------------------- ring util

/** Additive tilted elliptical ring with seeded band structure. */
function drawTiltedRing(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
  rotDeg: number, col: Rgba, opacity: number, noise: PerlinNoise,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const band = noise.fbm(t * 5 + 3, 2, 0.5, 3, 0.5, 2) * 0.5 + 0.5;
    const a = opacity * Math.max(0, band * 1.3 - 0.2);
    if (a <= 0.004) continue;
    ctx.strokeStyle = css(col, Math.min(1, a));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * (0.85 + 0.3 * t), ry * (0.85 + 0.3 * t), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Additive full-canvas ring band. */
function addRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, col: Rgba, intensity: number): void {
  const w = Math.max(3, radius * 0.06);
  const g = ctx.createRadialGradient(x, y, Math.max(0, radius - w), x, y, radius + w);
  g.addColorStop(0, css(col, 0));
  g.addColorStop(0.5, css(col, intensity));
  g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - radius - w, y - radius - w, (radius + w) * 2, (radius + w) * 2);
}
