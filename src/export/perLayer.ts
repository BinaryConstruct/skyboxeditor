/**
 * Per-layer + data export (VISION pillar 3): serialize star/billboard/galaxy
 * layer content as engine-neutral data (JSON + CSV) and describe the whole
 * stack in a composite.json sidecar so the original look is reproducible
 * from the separated per-layer images.
 */
import type { BlendFactor, Layer } from '../core/layers';

/** Extracted particle data for one layer. Positions use sky radius = 1. */
export interface StarData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  count: number;
  /** 'pixels': source point size; 'sky-radius': world quad size on the unit sky */
  sizeUnit: 'pixels' | 'sky-radius';
}

/** Trim float32 noise (0.10000000149…) for readable, smaller files. */
const round = (x: number) => Number(x.toPrecision(7));

export function starDataJson(layerName: string, d: StarData): string {
  return JSON.stringify({
    layer: layerName,
    count: d.count,
    units: { position: 'sky radius = 1', size: d.sizeUnit },
    positions: Array.from(d.positions, round),
    colors: Array.from(d.colors, round),
    sizes: Array.from(d.sizes, round),
  });
}

export function starDataCsv(d: StarData): string {
  const lines = ['x,y,z,r,g,b,a,size'];
  for (let i = 0; i < d.count; i++) {
    lines.push([
      round(d.positions[i * 3]),
      round(d.positions[i * 3 + 1]),
      round(d.positions[i * 3 + 2]),
      round(d.colors[i * 4]),
      round(d.colors[i * 4 + 1]),
      round(d.colors[i * 4 + 2]),
      round(d.colors[i * 4 + 3]),
      round(d.sizes[i]),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

/** File references for one baked image set (solo layer or the flattened composite). */
export interface ImageRefs {
  /** 6 cube face PNGs in GL order posx negx posy negy posz negz */
  faces?: string[];
  /** equirect PNG */
  image?: string;
  imageHdr?: string;
  imageExr?: string;
}

export interface CompositeLayerEntry extends ImageRefs {
  index: number;
  name: string;
  type: Layer['type'];
  blend: { source: BlendFactor; dest: BlendFactor };
  seed: number;
  /** zip-relative paths of the particle data, for star-bearing layers */
  data?: { json: string; csv: string; sizeUnit: StarData['sizeUnit'] };
  /** billboard texture id, so engines know which sprite to instance */
  texture?: string;
  /**
   * Distortion layers (black hole) bend the layers below them — a solo bake
   * is meaningless, so they carry no image; only the flattened composite
   * shows their effect.
   */
  distortion?: boolean;
}

export function compositeEntry(layer: Layer, index: number): CompositeLayerEntry {
  return {
    index,
    name: layer.name,
    type: layer.type,
    blend: { source: layer.sourceBlendFactor, dest: layer.destBlendFactor },
    seed: layer.seed,
    ...(layer.type === 'billboards' ? { texture: layer.texture } : {}),
    ...(layer.type === 'blackhole' ? { distortion: true } : {}),
  };
}

export function compositeJson(
  meta: { preset: string; faceSize: number; composite?: ImageRefs },
  entries: CompositeLayerEntry[],
): string {
  return JSON.stringify(
    {
      format: 'spacescape-web-composite',
      version: 1,
      preset: meta.preset,
      faceSize: meta.faceSize,
      notes:
        'Layers are baked solo on black, listed bottom-to-top. Recomposite by ' +
        'blending each image with the given GL blend factors (source/dest), or ' +
        'instance the data files as engine particles instead of using the image. ' +
        '"composite" is the fully flattened bake of all layers. Caveat: image ' +
        'alpha is flattened to opaque, so additive blends (one/one) recomposite ' +
        'exactly; alpha-dependent blends are approximate — use the flattened ' +
        'composite or the data files for those. Distortion layers carry no solo ' +
        'image (distortion: true).',
      ...(meta.composite ? { composite: meta.composite } : {}),
      layers: entries,
    },
    null,
    2,
  );
}

/** Filesystem-safe layer file stem: "02-blue-nebula". */
export function layerFileStem(layer: Layer, index: number): string {
  const slug = layer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || layer.type;
  return `${String(index + 1).padStart(2, '0')}-${slug}`;
}
