/**
 * Non-spiral galaxy morphologies for the Stars-tab galaxy generator:
 * elliptical/S0 (analytic Sérsic), edge-on disk with a sech² profile + dust
 * lane silhouette, and a Plummer/King globular cluster. The spiral path stays
 * in generators.ts (bakeGalaxyGen) — these are dispatched to by `morphology`.
 *
 * Recipes: docs/PCG-SAMPLES-RESEARCH.md §2.1 / §2.2 / §2.6. All randomness is
 * seeded (MsvcRng / PerlinNoise), so a seed+params pair always bakes the same
 * sprite.
 */
import { kelvinToRgb } from '../core/blackbody';
import type { Rgba } from '../core/layers';
import { PerlinNoise } from '../core/perlin';
import { MsvcRng } from '../core/rng';
import { GEN_SIZE, cssRgba, makeCanvas } from './genCommon';
import { plummerRadius, sech2, sersicIntensity } from './profiles';
import type { GalaxyGenParams } from './generators';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rgba mix, t in 0..1. */
function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: a.r + t * (b.r - a.r),
    g: a.g + t * (b.g - a.g),
    b: a.b + t * (b.b - a.b),
    a: 1,
  };
}

// -------------------------------------------------------- elliptical / S0

/**
 * Elliptical / lenticular galaxy: a single analytic Sérsic profile in
 * elliptical coordinates — no structural noise (S7's red-sequence tiles are
 * featureless), just a smooth concentrated core + huge soft halo, ±low-freq
 * asymmetry, faint resolved-giant speckle in the halo, warm red-sequence
 * palette.
 */
export function bakeEllipticalGalaxy(p: GalaxyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const n = p.sersicN ?? 4;
  const q = p.axisRatio ?? 0.7;
  const pa = ((p.paDeg ?? 30) * Math.PI) / 180;
  const Re = size * 0.5 * (p.bulgeSize ?? 0.28); // half-light radius in px
  const cosA = Math.cos(pa);
  const sinA = Math.sin(pa);

  const noise = new PerlinNoise(p.seed >>> 0);
  const core = kelvinToRgb(p.bulgeKelvin); // warm gold/cream, old stars
  const halo: Rgba = { r: 1, g: 0.96, b: 0.9, a: 1 }; // slight bluing toward the edge

  const img = ctx.createImageData(size, size);
  const exposure = 0.85;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - c;
      const dy = py - c;
      // rotate into the galaxy's principal axes, then squash by the axis ratio
      const xr = dx * cosA + dy * sinA;
      const yr = -dx * sinA + dy * cosA;
      const r = Math.hypot(xr, yr / q);

      let I = sersicIntensity(r, Re, n);
      // ±low-freq FBM asymmetry so it isn't a perfect analytic oval
      const asym = noise.fbm(xr / size * 1.6 + 3.1, yr / size * 1.6, 0, 2, 0.5, 2);
      I *= 1 + 0.08 * asym;
      // containment envelope: Sérsic tails outlive the sprite — take the
      // profile to zero before the edge window bites, or it prints a ring
      const rr = Math.hypot(dx, dy) / c;
      const env = rr >= 0.88 ? 0 : rr <= 0.6 ? 1 : 1 - (rr - 0.6) / 0.28;
      I *= env * env * (3 - 2 * env);

      const val = 1 - Math.exp(-I * exposure);
      if (val < 0.003) continue;
      // redden core, blue the diffuse halo (mix ~ how far down the profile)
      const col = mixRgba(core, halo, clamp01(1 - I) * 0.35);
      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, col.r * val * 255);
      img.data[o + 1] = Math.min(255, col.g * val * 255);
      img.data[o + 2] = Math.min(255, col.b * val * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // faint resolved-giant speckle in the mid halo (S5 graininess)
  const rng = new MsvcRng((p.seed + 0x2b1d) >>> 0);
  const speckles = 900;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < speckles; i++) {
    // sample a radius biased to the halo (1..3 Re), random position angle
    const rr = Re * (1 + 2 * Math.sqrt(rng.unit()));
    const th = rng.unit() * Math.PI * 2;
    const xr = rr * Math.cos(th);
    const yr = rr * Math.sin(th) * q;
    const x = c + xr * cosA - yr * sinA;
    const y = c + xr * sinA + yr * cosA;
    if (x < 0 || x >= size || y < 0 || y >= size) continue;
    const I = sersicIntensity(rr, Re, n);
    const a = 0.03 * clamp01(I * 4);
    if (a < 0.004) continue;
    ctx.fillStyle = cssRgba(rng.unit() < 0.04 ? { r: 0.8, g: 0.85, b: 1, a: 1 } : core, a);
    ctx.fillRect(x, y, 1.1, 1.1);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// ------------------------------------------------------- edge-on disk

/**
 * Edge-on disk galaxy (NGC 891 / Sombrero look): a razor-thin stellar disk
 * with a sech² vertical profile crossed by a dark dust-lane silhouette, plus
 * a central Sérsic bulge. The lane both darkens and reddens the light behind
 * it (dust is brown-red, not gray).
 */
export function bakeEdgeOnGalaxy(p: GalaxyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const pa = ((p.paDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(pa);
  const sinA = Math.sin(pa);

  const hR = size * 0.5 * 0.42;                 // radial scale length (px)
  const z0 = hR * (p.scaleHeight ?? 0.14);      // vertical scale height (px)
  const tau0 = p.dustDepth ?? 2.4;              // central dust optical depth
  const zOff = z0 * (p.laneOffset ?? -0.15);    // lane offset from midplane
  const warp = p.warpAmount ?? 0.25;            // integral-sign warp
  // truncation radius, clamped INSIDE the sprite (3.1·hR = 130% of the
  // half-size — the disk tips were running off the canvas into a hard edge)
  const Rmax = Math.min(hR * 3.1, c * 0.84);
  const bulgeRe = hR * (p.bulgeSize ?? 0.28);

  const noise = new PerlinNoise(p.seed >>> 0);
  const bulgeCol = kelvinToRgb(p.bulgeKelvin);  // warm bulge
  const diskCol = kelvinToRgb(p.armKelvin);     // cooler disk tips

  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - c;
      const dy = py - c;
      const R = dx * cosA + dy * sinA;   // along the disk major axis
      const z = -dx * sinA + dy * cosA;  // perpendicular (height)
      const aR = Math.abs(R);
      if (aR > Rmax * 1.05) continue;

      // radial truncation: real disks end rather than fade forever
      const trunc = smoothstep(Rmax, 0.8 * Rmax, aR);
      const diskRadial = Math.exp(-aR / hR) * trunc;
      const Idisk = diskRadial * sech2(z / z0);

      // dust lane: clumpy τ (2-octave FBM), gently warped off the midplane
      const laneZ = zOff + warp * z0 * Math.sin((R / hR) * 1.7);
      const clump = 0.55 + 0.9 * (noise.fbm(R / hR * 1.3 + 11.7, 5.5, 0, 2, 0.55, 2.2) * 0.5 + 0.5);
      const tau = tau0 * clump * Math.exp(-aR / hR) * Math.exp(-Math.abs(z - laneZ) / (0.5 * z0));
      const atten = Math.exp(-tau);

      // central bulge (small Sérsic n≈2, mildly flattened)
      const rb = Math.hypot(R, z / 0.7);
      const Ibulge = sersicIntensity(rb, bulgeRe, 2) * 0.9;

      const diskLit = Idisk * atten;
      let val = 1 - Math.exp(-(diskLit + Ibulge) * 2.1);
      if (val < 0.003) continue;

      // color: bulge warm, disk tips cool, weighted by which dominates here
      const diskFrac = clamp01(diskLit / (diskLit + Ibulge + 1e-6));
      let col = mixRgba(bulgeCol, diskCol, diskFrac * clamp01(aR / hR));
      // where the lane bites, redden the remaining light (brown dust)
      const dustBite = clamp01(1 - atten);
      col = {
        r: col.r,
        g: col.g * (1 - 0.35 * dustBite),
        b: col.b * (1 - 0.55 * dustBite),
        a: 1,
      };
      val *= 1 - 0.15 * dustBite;

      const o = (py * size + px) * 4;
      img.data[o] = Math.min(255, col.r * val * 255);
      img.data[o + 1] = Math.min(255, col.g * val * 255);
      img.data[o + 2] = Math.min(255, col.b * val * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// --------------------------------------------------------- globular cluster

/**
 * Globular cluster: an unresolved additive core glow plus hundreds of
 * resolved point stars scattered from a Plummer inverse-CDF draw with a King
 * tidal cutoff. Old population — cream/gold with a few percent blue
 * stragglers for salt-and-pepper.
 */
export function bakeGlobularCluster(p: GalaxyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const a = size * 0.5 * (p.coreRadius ?? 0.12);   // Plummer scale radius (px)
  const rt = a * (p.tidalRatio ?? 11);             // King tidal radius (px)
  const nStars = p.stars ?? 2200;
  const coreGlow = p.coreGlow ?? 0.7;
  const blueFrac = p.blueFraction ?? 0.02;

  const rng = new MsvcRng(p.seed >>> 0);
  const cream = kelvinToRgb(p.bulgeKelvin);  // ~5000 K
  const blue = kelvinToRgb(p.armKelvin);     // ~9000 K stragglers

  ctx.globalCompositeOperation = 'lighter';

  // unresolved core: the center is too dense to resolve -> a soft glow
  if (coreGlow > 0) {
    const g = ctx.createRadialGradient(c, c, 0, c, c, a * 3.2);
    g.addColorStop(0, cssRgba(cream, 0.9 * coreGlow));
    g.addColorStop(0.25, cssRgba(cream, 0.4 * coreGlow));
    g.addColorStop(1, cssRgba(cream, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  for (let i = 0; i < nStars; i++) {
    // 3D Plummer radius, projected to 2D (drop one axis) for a round cluster
    let r3d = plummerRadius(rng.unit(), a);
    if (r3d > rt) r3d = rt * rng.unit(); // King cutoff: resample into the sphere
    // random direction on the unit sphere, then project (drop z)
    const cosPhi = 2 * rng.unit() - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const th = rng.unit() * Math.PI * 2;
    const x = c + r3d * sinPhi * Math.cos(th);
    const y = c + r3d * sinPhi * Math.sin(th);
    if (x < 0 || x >= size || y < 0 || y >= size) continue;

    // resolved stars fade in from the glowing core toward the sparse edge
    const edge = clamp01(r3d / (rt * 0.8));
    const star = rng.unit() < blueFrac ? blue : cream;
    const bright = 0.35 + 0.65 * rng.unit();
    const alpha = (0.25 + 0.6 * edge) * bright;
    const rad = 0.7 + rng.unit() * 0.9;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
    grd.addColorStop(0, cssRgba(star, alpha));
    grd.addColorStop(0.5, cssRgba(star, alpha * 0.5));
    grd.addColorStop(1, cssRgba(star, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(x - rad * 2.2, y - rad * 2.2, rad * 4.4, rad * 4.4);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------- deep field

/**
 * JWST deep-field: a scattered population of typed mini-galaxies
 * (elliptical / spiral / edge-on) at tiny apparent size, in a bimodal
 * red-sequence / blue-cloud color split, plus a fainter background swarm of
 * unresolved smudges and a few bright foreground stars with 6-spike
 * diffraction patterns. Reuses `stars` as the galaxy count and `spread` as the
 * blue fraction; warm/cool K are the red/blue anchors.
 */
export function bakeDeepField(p: GalaxyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const rng = new MsvcRng(p.seed >>> 0);
  const nGal = Math.min(600, Math.max(30, Math.round((p.stars ?? 2200) / 8)));
  const blueFrac = clamp01(p.spread ?? 0.45);
  const red = kelvinToRgb(p.bulgeKelvin);  // red sequence (old ellipticals)
  const blue = kelvinToRgb(p.armKelvin);   // blue cloud (star-forming discs)

  ctx.globalCompositeOperation = 'lighter';

  // faint background swarm: very small, very faint unresolved smudges
  for (let i = 0; i < nGal * 3; i++) {
    const x = rng.unit() * size;
    const y = rng.unit() * size;
    const isBlue = rng.unit() < blueFrac;
    const col = isBlue ? blue : red;
    const a = 0.03 + 0.05 * rng.unit();
    const s = 0.6 + rng.unit() * 1.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
    g.addColorStop(0, cssRgba(col, a));
    g.addColorStop(1, cssRgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - s * 2.2, y - s * 2.2, s * 4.4, s * 4.4);
  }

  // resolved mini-galaxies
  for (let i = 0; i < nGal; i++) {
    const x = rng.unit() * size;
    const y = rng.unit() * size;
    const isBlue = rng.unit() < blueFrac;
    const col = isBlue ? blue : red;
    const bright = 0.16 + 0.5 * rng.unit();
    const sz = 2 + rng.unit() * 7;
    // morphology mix: blue clouds skew disc/edge-on, red sequence skews elliptical
    const roll = rng.unit();
    const type = isBlue ? (roll < 0.5 ? 'spiral' : roll < 0.85 ? 'edge' : 'ellip')
      : (roll < 0.7 ? 'ellip' : roll < 0.9 ? 'spiral' : 'edge');
    drawMiniGalaxy(ctx, x, y, sz, col, bright, type, rng.unit() * Math.PI);
  }

  // a few bright foreground stars with JWST 6+2 diffraction spikes
  const nStar = 6;
  for (let i = 0; i < nStar; i++) {
    const x = rng.unit() * size;
    const y = rng.unit() * size;
    const col = kelvinToRgb(4000 + rng.unit() * 12000);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, cssRgba(col, 0.6));
    g.addColorStop(1, cssRgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, y - 6, 12, 12);
    for (const a of [0, 60, 120]) miniSpike(ctx, x, y, a + 90, 14 + rng.unit() * 8);
    miniSpike(ctx, x, y, 0, 8);
    miniSpike(ctx, x, y, 180, 8);
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** One tiny galaxy: elliptical blob, fuzzy spiral disc, or edge-on streak. */
function drawMiniGalaxy(
  ctx: CanvasRenderingContext2D, x: number, y: number, sz: number,
  col: Rgba, bright: number, type: string, rot: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (type === 'edge') {
    ctx.scale(1, 0.28); // razor-thin
  } else if (type === 'spiral') {
    ctx.scale(1, 0.7 + 0.25 * Math.cos(rot * 3));
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 2.4);
  const coreA = Math.min(1, bright * (type === 'ellip' ? 1.1 : 0.9));
  g.addColorStop(0, cssRgba({ r: 1, g: 1, b: 1, a: 1 }, coreA));
  g.addColorStop(0.28, cssRgba(col, bright * 0.7));
  g.addColorStop(0.7, cssRgba(col, bright * 0.22));
  g.addColorStop(1, cssRgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-sz * 2.4, -sz * 2.4, sz * 4.8, sz * 4.8);
  ctx.restore();
}

/** Small additive diffraction spike for a deep-field foreground star. */
function miniSpike(ctx: CanvasRenderingContext2D, x: number, y: number, angleDeg: number, length: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const g = ctx.createLinearGradient(0, 0, length, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, -0.6, length, 1.2);
  ctx.restore();
}

// ------------------------------------------------------ interacting pair

interface Body { x: number; y: number; vx: number; vy: number; }

/**
 * Interacting / merging pair with tidal tails (§2.4), via a restricted
 * three-body integration: two point masses fly by on a ~parabolic encounter
 * while each carries a disc of massless test particles on initially circular
 * orbits. Integrating everyone in the combined (softened) two-point-mass
 * potential grows genuine bridges and tails — deterministic from the seed
 * (orbital phases) and the encounter params.
 */
export function bakeInteractingGalaxy(p: GalaxyGenParams): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const size = GEN_SIZE;
  const c = size / 2;
  const rng = new MsvcRng(p.seed >>> 0);

  const M1 = 1;
  const M2 = Math.min(1, Math.max(0.1, p.massRatio ?? 0.6));
  const mu = M1 + M2;
  const rp = p.periDistance ?? 0.28; // pericenter separation (normalized, half-size = 1)
  const phase = p.phase ?? 0.6;
  const eps2 = 0.03 * 0.03;          // softening²
  const d0 = 1.35;                    // start separation

  // parabolic encounter: place the separation along +x, split into COM frame
  const h = Math.sqrt(2 * mu * rp);         // specific angular momentum
  const vRel = Math.sqrt(2 * mu / d0);       // parabolic speed at d0
  const vt = h / d0;                          // tangential component
  const vr = -Math.sqrt(Math.max(0, vRel * vRel - vt * vt)); // incoming
  // relative state r = (d0,0), v = (vr, vt)
  const centers: Body[] = [
    { x: (-M2 / mu) * d0, y: 0, vx: (-M2 / mu) * vr, vy: (-M2 / mu) * vt },
    { x: (M1 / mu) * d0, y: 0, vx: (M1 / mu) * vr, vy: (M1 / mu) * vt },
  ];
  const masses = [M1, M2];

  // test-particle discs, one per galaxy (prograde circular orbits)
  const disc1 = 0.34;
  const disc2 = 0.34 * Math.cbrt(M2);
  const nEach = 1600;
  const parts: Body[] = [];
  const host: number[] = [];
  const spawn = (host_i: number, discR: number) => {
    for (let i = 0; i < nEach; i++) {
      const rr = discR * (0.1 + 0.9 * Math.sqrt(rng.unit()));
      const th = rng.unit() * Math.PI * 2;
      const px = centers[host_i].x + rr * Math.cos(th);
      const py = centers[host_i].y + rr * Math.sin(th);
      const vc = Math.sqrt((masses[host_i]) / rr); // circular speed about host
      // prograde tangential velocity + host center velocity
      const vx = centers[host_i].vx - vc * Math.sin(th);
      const vy = centers[host_i].vy + vc * Math.cos(th);
      parts.push({ x: px, y: py, vx, vy });
      host.push(host_i);
    }
  };
  spawn(0, disc1);
  spawn(1, disc2);

  // leapfrog (kick-drift-kick) — centers attract each other, particles feel both
  const dt = 0.012;
  const steps = Math.round(95 + phase * 150);
  const accCenters = (b: Body[]) => {
    const ax = [0, 0];
    const ay = [0, 0];
    const dx = b[1].x - b[0].x;
    const dy = b[1].y - b[0].y;
    const inv = 1 / Math.pow(dx * dx + dy * dy + eps2, 1.5);
    ax[0] = M2 * dx * inv; ay[0] = M2 * dy * inv;
    ax[1] = -M1 * dx * inv; ay[1] = -M1 * dy * inv;
    return { ax, ay };
  };
  const accPart = (pt: Body) => {
    let ax = 0;
    let ay = 0;
    for (let k = 0; k < 2; k++) {
      const dx = centers[k].x - pt.x;
      const dy = centers[k].y - pt.y;
      const inv = masses[k] / Math.pow(dx * dx + dy * dy + eps2, 1.5);
      ax += dx * inv; ay += dy * inv;
    }
    return { ax, ay };
  };
  for (let s = 0; s < steps; s++) {
    let ac = accCenters(centers);
    for (let k = 0; k < 2; k++) { centers[k].vx += 0.5 * dt * ac.ax[k]; centers[k].vy += 0.5 * dt * ac.ay[k]; }
    const ap = parts.map(accPart);
    for (let i = 0; i < parts.length; i++) { parts[i].vx += 0.5 * dt * ap[i].ax; parts[i].vy += 0.5 * dt * ap[i].ay; }
    for (let k = 0; k < 2; k++) { centers[k].x += dt * centers[k].vx; centers[k].y += dt * centers[k].vy; }
    for (let i = 0; i < parts.length; i++) { parts[i].x += dt * parts[i].vx; parts[i].y += dt * parts[i].vy; }
    ac = accCenters(centers);
    for (let k = 0; k < 2; k++) { centers[k].vx += 0.5 * dt * ac.ax[k]; centers[k].vy += 0.5 * dt * ac.ay[k]; }
    const ap2 = parts.map(accPart);
    for (let i = 0; i < parts.length; i++) { parts[i].vx += 0.5 * dt * ap2[i].ax; parts[i].vy += 0.5 * dt * ap2[i].ay; }
  }

  // recenter on the pair's center of mass and scale to fit the sprite
  const comx = (centers[0].x * M1 + centers[1].x * M2) / mu;
  const comy = (centers[0].y * M1 + centers[1].y * M2) / mu;
  const scale = size * 0.30; // normalized unit -> px
  const toPx = (x: number, y: number) => ({ x: c + (x - comx) * scale, y: c + (y - comy) * scale });

  const warm = kelvinToRgb(p.bulgeKelvin);
  const cool = kelvinToRgb(p.armKelvin);
  // tidally triggered star formation -> tails slightly bluer than cores
  const tailCol = mixRgba(warm, cool, 0.6);

  ctx.globalCompositeOperation = 'lighter';
  // bulge glows at each surviving center
  for (let k = 0; k < 2; k++) {
    const pos = toPx(centers[k].x, centers[k].y);
    const rad = (k === 0 ? 34 : 34 * Math.cbrt(M2));
    const col = k === 0 ? warm : mixRgba(warm, cool, 0.3);
    const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, rad);
    g.addColorStop(0, cssRgba(col, 0.95));
    g.addColorStop(0.3, cssRgba(col, 0.4));
    g.addColorStop(1, cssRgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(pos.x - rad, pos.y - rad, rad * 2, rad * 2);
  }
  // test-particle splats
  for (let i = 0; i < parts.length; i++) {
    const pos = toPx(parts[i].x, parts[i].y);
    if (pos.x < -4 || pos.x >= size + 4 || pos.y < -4 || pos.y >= size + 4) continue;
    const col = host[i] === 0 ? warm : tailCol;
    const rad = 1.3;
    const a = 0.22;
    const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, rad * 2.4);
    g.addColorStop(0, cssRgba(col, a));
    g.addColorStop(1, cssRgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(pos.x - rad * 2.4, pos.y - rad * 2.4, rad * 4.8, rad * 4.8);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
