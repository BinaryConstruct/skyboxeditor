/**
 * HYG-style star catalog CSV support, ported from the upstream 0.5.x
 * SpacescapeLayerBillboards::buildFromFile: header row with case-insensitive
 * x, y, z, absmag, distance (+ optional colorIndex/bv, name) columns.
 * Positions normalize onto the unit sphere; apparent brightness filters and
 * shapes size/color.
 */
import { bvToKelvin, kelvinToRgb } from './blackbody';
import type { BillboardsLayer } from './layers';
import type { Billboards } from './billboards';

export interface CatalogStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
  distance: number;
  bv?: number;
}

const MAX_DIST = 20000; // parsecs, as upstream
const MAG_MAX = 6.5; // naked-eye limit, as upstream
const MAG_MIN = -1.44; // ~Sirius

export function parseStarCsv(text: string): CatalogStar[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const ix = col('x');
  const iy = col('y');
  const iz = col('z');
  const imag = col('absmag');
  const idist = col('distance');
  const ibv = col('colorindex', 'bv', 'ci');
  if (ix < 0 || iy < 0 || iz < 0 || imag < 0 || idist < 0) return [];

  const stars: CatalogStar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const star: CatalogStar = {
      x: Number(cells[ix]),
      y: Number(cells[iy]),
      z: Number(cells[iz]),
      absmag: Number(cells[imag]),
      distance: Number(cells[idist]),
    };
    if (!Number.isFinite(star.x) || !Number.isFinite(star.y) || !Number.isFinite(star.z)) continue;
    if (!Number.isFinite(star.absmag) || !Number.isFinite(star.distance)) continue;
    if (ibv >= 0) {
      const bv = Number(cells[ibv]);
      if (Number.isFinite(bv)) star.bv = bv;
    }
    stars.push(star);
  }
  return stars;
}

/** Build billboard data from a catalog (upstream buildFromFile math). */
export function billboardsFromCatalog(layer: BillboardsLayer, stars: CatalogStar[]): Billboards {
  const f = Math.fround;
  const { minSize, maxSize, nearColor, farColor } = layer;
  const hdrPower = layer.hdrPower ?? 1;
  const hdrMult = layer.hdrMultiplier ?? 1;

  const positions: number[] = [];
  const sizes: number[] = [];
  const colors: number[] = [];

  for (const s of stars) {
    let dist = s.distance;
    if (dist < 0.1) continue; // too close (the Sun), as upstream

    // apparent magnitude via distance modulus; skip too-faint stars
    const apparent = s.absmag - 5 * Math.log10(10.0 / dist);
    if (apparent > MAG_MAX) continue;

    const len = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    if (!(len > 0)) continue;
    positions.push(s.x / len, s.y / len, s.z / len);

    dist = Math.min(dist, MAX_DIST) / MAX_DIST;
    sizes.push(f(minSize + f(maxSize - minSize) * (1 - dist)));

    // normalized brightness 0..1 (bright = 1), HDR-shaped as upstream
    let mag = (MAG_MAX - apparent) / (MAG_MAX - MAG_MIN);
    mag = Math.min(1, Math.max(0, mag));
    if (hdrPower !== 1) mag = Math.pow(mag, hdrPower);

    const base = s.bv !== undefined
      ? kelvinToRgb(bvToKelvin(s.bv))
      : {
          r: nearColor.r + dist * (farColor.r - nearColor.r),
          g: nearColor.g + dist * (farColor.g - nearColor.g),
          b: nearColor.b + dist * (farColor.b - nearColor.b),
          a: 1,
        };
    colors.push(
      f(base.r * mag * hdrMult),
      f(base.g * mag * hdrMult),
      f(base.b * mag * hdrMult),
      1,
    );
  }

  return {
    positions: new Float32Array(positions),
    sizes: new Float32Array(sizes),
    colors: new Float32Array(colors),
    count: sizes.length,
  };
}
