import { describe, expect, it } from 'vitest';
import { toJsonString } from './io';
import { defaultLayer } from './layers';
import { parseSceneScript, positionToLineCol, serializeScene } from './sceneScript';

describe('positionToLineCol', () => {
  it('maps offset 0 to line 1, column 1', () => {
    expect(positionToLineCol('abc', 0)).toEqual({ line: 1, col: 1 });
  });

  it('counts columns within the first line', () => {
    expect(positionToLineCol('abcdef', 3)).toEqual({ line: 1, col: 4 });
  });

  it('advances the line after each newline and resets the column', () => {
    const text = 'one\ntwo\nthree';
    // offset of the 't' in "three": 'one\n' (4) + 'two\n' (4) = 8
    expect(positionToLineCol(text, 8)).toEqual({ line: 3, col: 1 });
    // the char right after the first newline
    expect(positionToLineCol(text, 4)).toEqual({ line: 2, col: 1 });
  });

  it('clamps a position past the end to the text end', () => {
    expect(positionToLineCol('ab', 99)).toEqual({ line: 1, col: 3 });
  });
});

describe('parseSceneScript — valid round-trip', () => {
  it('is byte-stable through an untouched serialize→parse→serialize cycle', () => {
    const layers = [
      defaultLayer('noise', 'Base Nebula'),
      defaultLayer('points', 'Stars'),
      defaultLayer('sprite', 'Baked Body'),
    ];
    const text = serializeScene(layers);

    const parsed = parseSceneScript(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // loaded layers match the originals, and re-serializing is identical text
    expect(parsed.layers).toEqual(layers);
    expect(serializeScene(parsed.layers)).toBe(text);
    expect(toJsonString(parsed.layers)).toBe(text);
  });
});

describe('parseSceneScript — JSON syntax errors', () => {
  it('locates an unexpected end of input at the end of the text', () => {
    const text = '{\n  "version": 2,\n  "layers": [';
    const result = parseSceneScript(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // truncated JSON points at where the text stops, not line 1
    expect(result.error.line).toBe(3);
    expect(result.error.message).toMatch(/JSON syntax error at line 3/);
  });

  it('reports a line and column for malformed JSON', () => {
    // valid up to the trailing comma / EOF on line 3
    const text = '{\n  "version": 2,\n  "layers": [ { ]\n}';
    const result = parseSceneScript(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.line).toBeGreaterThanOrEqual(1);
    expect(result.error.message).toMatch(/JSON syntax error/);
    // the failure sits on line 3 (the "[ { ]")
    expect(result.error.line).toBe(3);
  });
});

describe('parseSceneScript — schema errors', () => {
  it('names the layer and rejects an unknown layer type', () => {
    const text = toJsonString([]).replace('"layers": []', '"layers": [\n    { "type": "wormhole", "name": "Portal" }\n  ]');
    const result = parseSceneScript(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Layer 0');
    expect(result.error.message).toContain('Portal');
    expect(result.error.message).toContain('unknown layer type');
    expect(result.error.message).toContain('wormhole');
  });

  it('names the field when a value has the wrong kind', () => {
    const result = parseSceneScript(JSON.stringify({
      version: 2,
      layers: [{ type: 'points', name: 'Stars', numPoints: 'lots' }],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Stars');
    expect(result.error.message).toContain('numPoints');
    expect(result.error.message).toContain('number');
  });

  it('rejects a real01 value outside 0..1 instead of silently clamping', () => {
    const result = parseSceneScript(JSON.stringify({
      version: 2,
      layers: [{ type: 'galaxy', name: 'Hero', dust: 1.7 }],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('dust');
    expect(result.error.message).toContain('0..1');
  });

  it('rejects an unknown blend factor and lists the valid ones', () => {
    const result = parseSceneScript(JSON.stringify({
      version: 2,
      layers: [{ type: 'points', name: 'Stars', sourceBlendFactor: 'screen' }],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('sourceBlendFactor');
    expect(result.error.message).toContain('screen');
    expect(result.error.message).toContain('one_minus_src_alpha');
  });

  it('rejects a non-v2 document with a clear message', () => {
    const result = parseSceneScript('{"version":1,"layers":[]}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('version');
  });
});
