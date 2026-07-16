import { describe, expect, it } from 'vitest';
import {
  PCG_LAYER_COUNT, defaultLayerParams, pcgLayerDescriptor, pcgLayerDescriptors,
} from './pcgLayers';
import { pcgLayerTypes, validatePcgObject, type PcgObjectSpec } from './pcgSpec';

describe('pcg component-layer registry', () => {
  it('registers every §8 layer type with a descriptor', () => {
    const types = pcgLayerDescriptors().map((d) => d.type);
    expect(types).toHaveLength(PCG_LAYER_COUNT);
    for (const t of [
      'photosphere', 'corona-streamers', 'prominence-arcs', 'glow-halo',
      'accretion-disc', 'jet-pair', 'shell', 'star-scatter', 'dust-lane',
      'diffraction-spikes', 'lens-art',
    ]) {
      expect(types).toContain(t);
      // and the renderer is registered against the composition framework
      expect(pcgLayerTypes()).toContain(t);
    }
  });

  it('builds default params from each descriptor', () => {
    const p = defaultLayerParams('photosphere');
    expect(p.kelvin).toBe(5800);
    expect(p.radius).toBe(0.16);
    // unknown type yields an empty param bag, not a throw
    expect(defaultLayerParams('nope')).toEqual({});
  });

  it('dust-lane defaults to a multiply blend so it can darken', () => {
    expect(pcgLayerDescriptor('dust-lane')?.blend).toBe('multiply');
    expect(pcgLayerDescriptor('photosphere')?.blend).toBe('add');
  });

  it('a stack assembled from registered types validates', () => {
    const spec: PcgObjectSpec = {
      schemaVersion: 1, classId: 'star', subtypeId: 'g-class', name: 't', seed: 3,
      layers: [
        { id: 'body', type: 'photosphere', enabled: true, seed: 1, blendMode: 'add', params: defaultLayerParams('photosphere') },
        { id: 'halo', type: 'glow-halo', enabled: true, seed: 2, blendMode: 'add', params: defaultLayerParams('glow-halo') },
        { id: 'lane', type: 'dust-lane', enabled: true, seed: 3, blendMode: 'multiply', params: defaultLayerParams('dust-lane') },
      ],
    };
    expect(validatePcgObject(spec)).toEqual([]);
  });
});
