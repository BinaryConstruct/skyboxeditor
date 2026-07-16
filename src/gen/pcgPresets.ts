/**
 * Composable-object presets: named (classification → subtype) layer stacks
 * assembled from the §8 component-layer library (pcgLayers.ts). These are the
 * StellarObjectResearch2 §9 recipes expressed as pcgSpec objects — the
 * starting point the spec-driven editor (StarsTab PCG mode) seeds when you pick
 * a classification + Style, then lets you enable/disable/reorder/tune per layer.
 *
 * Importing this module registers the component layers (side effect of
 * importing pcgLayers), so composePcgObject can render any preset.
 */
import {
  defaultLayerParams, pcgLayerDescriptor,
} from './pcgLayers';
import type { PcgLayerSpec, PcgObjectSpec } from './pcgSpec';

/** Build a layer spec, merging descriptor defaults with overrides. */
function L(
  id: string, type: string, params: Record<string, unknown> = {}, seed = 1,
): PcgLayerSpec {
  return {
    id,
    type,
    enabled: true,
    seed,
    blendMode: pcgLayerDescriptor(type)?.blend ?? 'add',
    params: { ...defaultLayerParams(type), ...params },
  };
}

export interface PcgPreset {
  classId: string;
  subtypeId: string;
  label: string;
  build: () => PcgLayerSpec[];
}

/** Ordered preset catalog; the editor groups these by classId. */
export const PCG_PRESETS: PcgPreset[] = [
  {
    classId: 'star', subtypeId: 'g-class', label: 'G — Sun-like',
    build: () => [
      L('photosphere', 'photosphere', { kelvin: 5800, radius: 0.16, granulation: 0.35 }, 1),
      L('corona', 'corona-streamers', { kelvin: 5800, radius: 0.16, intensity: 0.7, extent: 1.4 }, 2),
      L('prominences', 'prominence-arcs', { radius: 0.16, amount: 0.4 }, 3),
      L('halo', 'glow-halo', { kelvin: 5800, radius: 0.16, intensity: 0.5 }, 4),
    ],
  },
  {
    classId: 'star', subtypeId: 'o-blue', label: 'O — blue supergiant',
    build: () => [
      L('photosphere', 'photosphere', { kelvin: 40000, radius: 0.15, granulation: 0.05, limbDarkening: 0.25 }, 1),
      L('halo', 'glow-halo', { kelvin: 30000, radius: 0.15, intensity: 0.85, falloff: 3 }, 2),
      L('spikes', 'diffraction-spikes', { style: 'hubble', length: 0.32, intensity: 0.9 }, 3),
    ],
  },
  {
    classId: 'anomaly', subtypeId: 'black-hole', label: 'Black hole (lens art)',
    build: () => [
      L('lens', 'lens-art', { horizon: 0.1, discInner: 2.2, discOuter: 6, tilt: 75, kelvin: 12000, doppler: 0.7 }, 1),
      L('ambient', 'glow-halo', { kelvin: 14000, radius: 0.3, intensity: 0.12, falloff: 3 }, 2),
    ],
  },
  {
    classId: 'anomaly', subtypeId: 'quasar', label: 'Quasar',
    build: () => [
      L('host', 'glow-halo', { kelvin: 5000, radius: 0.3, intensity: 0.14, falloff: 3.5 }, 1),
      L('jets', 'jet-pair', { angle: 20, length: 0.42, width: 5, knots: 4, asymmetry: 0.65, kelvin: 18000 }, 2),
      L('core', 'glow-halo', { kelvin: 16000, radius: 0.06, intensity: 0.9, falloff: 1.4 }, 3),
      L('point', 'photosphere', { kelvin: 18000, radius: 0.03, granulation: 0 }, 4),
      L('spikes', 'diffraction-spikes', { style: 'hubble', length: 0.24, intensity: 0.85 }, 5),
    ],
  },
  {
    classId: 'anomaly', subtypeId: 'microquasar', label: 'Microquasar (accreting BH)',
    build: () => [
      L('disc', 'accretion-disc', { rInner: 0.06, rOuter: 0.3, tilt: 68, kelvin: 16000, doppler: 0.7 }, 1),
      L('jets', 'jet-pair', { angle: 90, length: 0.4, width: 4, knots: 3, asymmetry: 0.3, kelvin: 20000, hollow: 0.3 }, 2),
      L('core', 'glow-halo', { kelvin: 18000, radius: 0.05, intensity: 0.6, falloff: 1.6 }, 3),
    ],
  },
  {
    classId: 'galaxy', subtypeId: 'spiral', label: 'Spiral galaxy',
    build: () => [
      L('bulge', 'glow-halo', { kelvin: 4200, radius: 0.14, intensity: 0.6, falloff: 2.6 }, 1),
      L('disk', 'star-scatter', { mode: 'spiral', count: 1400, radius: 0.44, kelvin: 9000, arms: 2, windings: 1.1 }, 2),
      L('dust', 'dust-lane', { angle: 30, offset: 0, width: 0.05, depth: 0.6 }, 3),
    ],
  },
  {
    classId: 'galaxy', subtypeId: 'elliptical', label: 'Elliptical galaxy',
    build: () => [
      L('halo', 'glow-halo', { kelvin: 3800, radius: 0.3, intensity: 0.5, falloff: 3 }, 1),
      L('stars', 'star-scatter', { mode: 'plummer', count: 1200, radius: 0.42, kelvin: 4600 }, 2),
    ],
  },
  {
    classId: 'nebula', subtypeId: 'planetary-shell', label: 'Planetary nebula shell',
    build: () => [
      L('shell', 'shell', { mode: 'limb', radius: 0.34, thickness: 0.06, kelvin: 14000 }, 1),
      L('central', 'glow-halo', { kelvin: 25000, radius: 0.04, intensity: 0.7, falloff: 1.4 }, 2),
      L('stars', 'star-scatter', { mode: 'uniform', count: 200, radius: 0.46, kelvin: 7000 }, 3),
    ],
  },
  {
    classId: 'anomaly', subtypeId: 'supernova', label: 'Supernova remnant',
    build: () => [
      L('shock', 'shell', { mode: 'limb', radius: 0.36, thickness: 0.06, kelvin: 16000 }, 1),
      L('knots', 'star-scatter', { mode: 'plummer', count: 300, radius: 0.34, kelvin: 6000 }, 2),
      L('core', 'glow-halo', { kelvin: 9000, radius: 0.05, intensity: 0.9, falloff: 2 }, 3),
      L('spikes', 'diffraction-spikes', { style: 'hubble', length: 0.28, intensity: 0.8 }, 4),
    ],
  },
];

/** Look up a preset's layers by classification + subtype. */
export function pcgPresetSpec(classId: string, subtypeId: string, seed: number): PcgObjectSpec | null {
  const preset = PCG_PRESETS.find((p) => p.classId === classId && p.subtypeId === subtypeId);
  if (!preset) return null;
  const label = `${classId}-${subtypeId}`;
  return { schemaVersion: 1, classId, subtypeId, name: label, seed, layers: preset.build() };
}
