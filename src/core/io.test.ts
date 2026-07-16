// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportLegacyXml, fromJsonString, importLegacyXml, toJsonString } from './io';

// vitest runs with cwd = project root (import.meta.url is unusable under jsdom)
const PRESETS_DIR = join(process.cwd(), 'presets');
const presetFiles = readdirSync(PRESETS_DIR).filter((f: string) => f.endsWith('.xml'));

describe('legacy XML import', () => {
  it('finds the bundled presets', () => {
    expect(presetFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(presetFiles)('imports %s with no unknown params', (file: string) => {
    const { layers, warnings } = importLegacyXml(readFileSync(join(PRESETS_DIR, file), 'utf8'));
    expect(warnings).toEqual([]);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(['noise', 'points', 'billboards', 'volumetric']).toContain(layer.type);
      expect(layer.name.length).toBeGreaterThan(0);
    }
  });

  it('parses known values from purple-nebula-complex.xml', () => {
    const { layers } = importLegacyXml(
      readFileSync(join(PRESETS_DIR, 'purple-nebula-complex.xml'), 'utf8'),
    );
    const first = layers[0];
    expect(first.type).toBe('noise');
    expect(first.name).toBe('Pink Purple Nebula');
    if (first.type === 'noise') {
      expect(first.octaves).toBe(8);
      expect(first.innerColor).toEqual({ r: 1, g: 0, b: 0.6, a: 1 });
      expect(first.outerColor.g).toBeCloseTo(0.309804, 6);
      expect(first.noiseType).toBe('fbm');
    }
  });

  it('throws on malformed XML', () => {
    expect(() => importLegacyXml('<spacescapelayers><layer>')).toThrow();
  });
});

describe('round-trips', () => {
  it.each(presetFiles)('legacy XML round-trip preserves %s', (file: string) => {
    const original = importLegacyXml(readFileSync(join(PRESETS_DIR, file), 'utf8'));
    const reimported = importLegacyXml(exportLegacyXml(original.layers));
    expect(reimported.warnings).toEqual([]);
    expect(reimported.layers).toEqual(original.layers);
  });

  it.each(presetFiles)('JSON v2 round-trip preserves %s', (file: string) => {
    const original = importLegacyXml(readFileSync(join(PRESETS_DIR, file), 'utf8'));
    const reimported = fromJsonString(toJsonString(original.layers));
    expect(reimported.warnings).toEqual([]);
    expect(reimported.layers).toEqual(original.layers);
  });

  it('rejects non-v2 JSON', () => {
    expect(() => fromJsonString('{"version":1,"layers":[]}')).toThrow();
    expect(() => fromJsonString('{}')).toThrow();
  });
});

describe('legacy parsing quirks (parity with the C++ loader)', () => {
  const wrap = (params: string) =>
    `<spacescapelayers><layer><type>points</type>${params}</layer></spacescapelayers>`;

  it('truncates pointSize like StringConverter::parseInt', () => {
    const { layers } = importLegacyXml(wrap('<pointSize>1.9</pointSize>'));
    expect(layers[0]).toMatchObject({ pointSize: 1 });
  });

  it('clamps maskThreshold to [0,1] like the C++ layers', () => {
    expect(importLegacyXml(wrap('<maskThreshold>2.5</maskThreshold>')).layers[0])
      .toMatchObject({ maskThreshold: 1 });
    expect(importLegacyXml(wrap('<maskThreshold>-3</maskThreshold>')).layers[0])
      .toMatchObject({ maskThreshold: 0 });
  });

  it('parses numeric prefixes like istream, and never yields NaN', () => {
    const { layers } = importLegacyXml(
      wrap('<maskGain>1.5junk</maskGain><nearColor>1 bad 0</nearColor>'),
    );
    expect(layers[0]).toMatchObject({
      maskGain: 1.5,
      nearColor: { r: 1, g: 0, b: 0, a: 1 },
    });
  });

  it('layers missing <type> default to points', () => {
    const { layers, warnings } = importLegacyXml(
      '<spacescapelayers><layer><name>x</name></layer></spacescapelayers>',
    );
    expect(warnings).toEqual([]);
    expect(layers[0].type).toBe('points');
  });
});

describe('JSON v2 robustness', () => {
  it('deep-merges partial colors and sanitizes bad values', () => {
    const { layers, warnings } = fromJsonString(JSON.stringify({
      version: 2,
      layers: [{
        type: 'points',
        name: 'partial',
        nearColor: { r: 0.25 },
        numPoints: 12.7,
        maskThreshold: 99,
        pointSize: 'huge',
      }],
    }));
    expect(warnings).toEqual([]);
    expect(layers[0]).toMatchObject({
      nearColor: { r: 0.25, g: 1, b: 1, a: 1 },
      numPoints: 12,
      maskThreshold: 1,
      pointSize: 1,
    });
    // sanitized layers must always survive XML export
    expect(() => exportLegacyXml(layers)).not.toThrow();
  });
});
