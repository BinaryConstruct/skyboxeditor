import { describe, expect, it } from 'vitest';
import {
  pcgExecutionOrder, registerPcgLayerType, validatePcgObject,
  type PcgLayerSpec, type PcgObjectSpec,
} from './pcgSpec';

const layer = (id: string, over: Partial<PcgLayerSpec> = {}): PcgLayerSpec => ({
  id,
  type: 'test-fill',
  enabled: true,
  seed: 1,
  blendMode: 'add',
  params: {},
  ...over,
});

const object = (layers: PcgLayerSpec[]): PcgObjectSpec => ({
  schemaVersion: 1,
  classId: 'star',
  subtypeId: 'g-class',
  name: 't',
  seed: 7,
  layers,
});

registerPcgLayerType('test-fill', () => {});

describe('pcgExecutionOrder', () => {
  it('keeps declaration order when there are no dependencies', () => {
    const order = pcgExecutionOrder([layer('a'), layer('b'), layer('c')]);
    expect(order.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('hoists dependencies before their consumers', () => {
    const order = pcgExecutionOrder([
      layer('dust', { dependsOn: ['arms'] }),
      layer('arms'),
    ]);
    expect(order.map((l) => l.id)).toEqual(['arms', 'dust']);
  });

  it('reports cycles with the offending chain', () => {
    expect(() =>
      pcgExecutionOrder([
        layer('a', { dependsOn: ['b'] }),
        layer('b', { dependsOn: ['a'] }),
      ]),
    ).toThrow(/cycle: a -> b -> a/);
  });
});

describe('validatePcgObject', () => {
  it('accepts a well-formed spec', () => {
    expect(validatePcgObject(object([layer('a'), layer('b', { dependsOn: ['a'] })]))).toEqual([]);
  });

  it('flags unknown types, duplicate ids, and missing deps', () => {
    const errors = validatePcgObject(object([
      layer('a', { type: 'nope' }),
      layer('a'),
      layer('b', { dependsOn: ['ghost'] }),
    ]));
    expect(errors.join('\n')).toMatch(/unknown layer type "nope"/);
    expect(errors.join('\n')).toMatch(/duplicate layer id "a"/);
    expect(errors.join('\n')).toMatch(/depends on missing layer "ghost"/);
  });
});
