/**
 * Batch seed export: deterministic seed variations of a layer stack.
 * Variation 0 is the authored preset verbatim; variation k re-seeds every
 * layer with a pure hash of (layer seed, k), so a variation's seeds never
 * depend on layer order, layer count, or anything baked previously.
 */
import type { Layer } from '../core/layers';

/** Pure (seed, k) -> seed. k = 0 returns the input verbatim (no coercion —
 * imported seeds outside uint32 must round-trip untouched in variation 1). */
export function variantSeed(seed: number, k: number): number {
  if (k === 0) return seed;
  // Knuth multiplicative hash over seed xor golden-ratio-scrambled k
  return Math.imul((seed >>> 0) ^ Math.imul(k, 0x9e3779b9), 2654435761) >>> 0;
}

/** Clone the stack with every layer re-seeded for variation k. */
export function variantLayers(layers: Layer[], k: number): Layer[] {
  return layers.map((l) => {
    const copy = structuredClone(l);
    copy.seed = variantSeed(l.seed, k);
    // points/billboards noise masks have their own seed; salt it so a layer
    // whose maskSeed happens to equal its seed still varies independently
    if (k > 0 && 'maskSeed' in copy) {
      copy.maskSeed = variantSeed((copy.maskSeed ^ 0xa5a5) >>> 0, k);
    }
    return copy;
  });
}

/** Seed record for one variation, for the batch manifest. */
export interface VariationManifestEntry {
  /** 1-based variation number, matching the v01/ folder name */
  variation: number;
  layerSeeds: Array<{ name: string; seed: number; maskSeed?: number }>;
}

export function manifestEntry(layers: Layer[], k: number): VariationManifestEntry {
  return {
    variation: k + 1,
    layerSeeds: layers.map((l) => ({
      name: l.name,
      seed: l.seed,
      ...('maskSeed' in l ? { maskSeed: l.maskSeed } : {}),
    })),
  };
}
