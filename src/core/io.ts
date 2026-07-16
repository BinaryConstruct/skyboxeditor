/**
 * File IO: legacy Spacescape .xml import/export (backward-compatible with the
 * original's TinyXML save format) and the native JSON v2 project format.
 *
 * Legacy format: <spacescapelayers><layer><param>value</param>...</layer>...
 * The original wrote params from a std::map, so elements are alphabetical;
 * the exporter reproduces that ordering.
 */
import {
  BLEND_FACTORS,
  defaultLayer,
  type BlendFactor,
  type Layer,
  type LayerType,
  type NoiseType,
  type RampStop,
  type Rgba,
} from './layers';

/**
 * 'real01' = real clamped to [0,1] on load, as the C++ does for maskThreshold.
 * 'ramp' = multi-stop color ramp ("t r g b a; ..." in XML, array in JSON; t clamped 0..1).
 * 'palette' = same shape but t is an unbounded weight (>= 0), not clamped.
 */
type FieldKind = 'real' | 'real01' | 'int' | 'bool' | 'color' | 'string' | 'blend' | 'noiseType' | 'ramp' | 'palette' | 'stringList';

const COMMON: Record<string, FieldKind> = {
  seed: 'int',
  sourceBlendFactor: 'blend',
  destBlendFactor: 'blend',
};

const MASK: Record<string, FieldKind> = {
  maskEnabled: 'bool',
  maskNoiseType: 'noiseType',
  maskSeed: 'int',
  maskOctaves: 'int',
  maskGain: 'real',
  maskLacunarity: 'real',
  maskOffset: 'real',
  maskPower: 'real',
  maskScale: 'real',
  maskThreshold: 'real01',
  maskWarpStrength: 'real',
  maskWarpScale: 'real',
};

/** 0.5.x params not present in every save; emitted only when set. */
const OPTIONAL: Record<LayerType, Record<string, FieldKind>> = {
  noise: { hdrPower: 'real', hdrMultiplier: 'real', colorRamp: 'ramp' },
  points: { hdrPower: 'real', hdrMultiplier: 'real', dataFile: 'string' },
  billboards: { hdrPower: 'real', hdrMultiplier: 'real', dataFile: 'string', huePalette: 'palette', textureMix: 'stringList' },
  volumetric: { hdrPower: 'real', hdrMultiplier: 'real', colorRamp: 'ramp' },
  galaxy: { hdrPower: 'real', hdrMultiplier: 'real', locked: 'bool' },
  sun: { hdrPower: 'real', hdrMultiplier: 'real', locked: 'bool' },
  planet: { hdrPower: 'real', hdrMultiplier: 'real', locked: 'bool' },
  blackhole: { hdrPower: 'real', hdrMultiplier: 'real', locked: 'bool' },
  sprite: { hdrPower: 'real', hdrMultiplier: 'real', locked: 'bool' },
};

const FIELDS: Record<LayerType, Record<string, FieldKind>> = {
  noise: {
    ...COMMON,
    noiseType: 'noiseType',
    octaves: 'int',
    gain: 'real',
    lacunarity: 'real',
    offset: 'real',
    scale: 'real',
    powerAmount: 'real',
    shelfAmount: 'real',
    ditherAmount: 'real',
    innerColor: 'color',
    outerColor: 'color',
    previewTextureSize: 'int',
    warpStrength: 'real',
    warpScale: 'real',
  },
  points: {
    ...COMMON,
    ...MASK,
    numPoints: 'int',
    // parsed with StringConverter::parseInt in the original
    pointSize: 'int',
    pointSizeMax: 'int',
    nearColor: 'color',
    farColor: 'color',
    colorMode: 'string',
    tempMin: 'real',
    tempMax: 'real',
    magnitudePower: 'real',
    bandStrength: 'real01',
    bandConcentration: 'real',
    bandAngleDeg: 'real',
  },
  billboards: {
    ...COMMON,
    ...MASK,
    numBillboards: 'int',
    minSize: 'real',
    maxSize: 'real',
    texture: 'string',
    nearColor: 'color',
    farColor: 'color',
    randomRotation: 'bool',
    aspectJitter: 'real01',
  },
  galaxy: {
    ...COMMON,
    dirLonDeg: 'real',
    dirLatDeg: 'real',
    apparentSize: 'real',
    tiltDeg: 'real',
    spinDeg: 'real',
    arms: 'int',
    windings: 'real',
    spread: 'real',
    bulgeSize: 'real',
    bulgeKelvin: 'real',
    armKelvin: 'real',
    numStars: 'int',
    starSize: 'real',
    coreGlow: 'real',
    thickness: 'real',
    dust: 'real01',
    nebulae: 'real01',
  },
  volumetric: {
    ...COMMON,
    noiseType: 'noiseType',
    octaves: 'int',
    gain: 'real',
    lacunarity: 'real',
    offset: 'real',
    scale: 'real',
    powerAmount: 'real',
    shelfAmount: 'real01',
    warpStrength: 'real',
    warpScale: 'real',
    innerColor: 'color',
    outerColor: 'color',
    steps: 'int',
    density: 'real',
    absorption: 'real',
    shellInner: 'real',
    shellOuter: 'real',
    previewTextureSize: 'int',
  },
  sun: {
    ...COMMON,
    dirLonDeg: 'real',
    dirLatDeg: 'real',
    apparentSize: 'real',
    rotationDeg: 'real',
    kelvin: 'real',
    limbDarkening: 'real01',
    granulation: 'real01',
    corona: 'real01',
    coronaExtent: 'real',
    prominences: 'real01',
    glow: 'real01',
  },
  planet: {
    ...COMMON,
    dirLonDeg: 'real',
    dirLatDeg: 'real',
    apparentSize: 'real',
    rotationDeg: 'real',
    baseColor: 'color',
    secondColor: 'color',
    noiseScale: 'real',
    octaves: 'int',
    banding: 'real01',
    lightAngleDeg: 'real',
    atmosphereColor: 'color',
    atmosphereWidth: 'real',
    ringAmount: 'real01',
    ringInner: 'real',
    ringOuter: 'real',
    ringTiltDeg: 'real',
    ringColor: 'color',
  },
  blackhole: {
    ...COMMON,
    dirLonDeg: 'real',
    dirLatDeg: 'real',
    apparentSize: 'real',
    lensStrength: 'real01',
    photonRing: 'real01',
    discAmount: 'real01',
    discInner: 'real',
    discOuter: 'real',
    discTiltDeg: 'real',
    discSpinDeg: 'real',
    discKelvin: 'real',
    discDoppler: 'real01',
  },
  sprite: {
    ...COMMON,
    texture: 'string',
    dirLonDeg: 'real',
    dirLatDeg: 'real',
    apparentSize: 'real',
    aspect: 'real',
    rotationDeg: 'real',
  },
};

// ---------------------------------------------------------------- parsing

/**
 * ~ Ogre StringConverter::parseReal (istream semantics): numeric prefixes
 * parse ("1.5junk" -> 1.5), no JS-only forms like hex, failure -> 0.
 */
function parseReal(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Ogre::StringConverter::parseBool semantics. */
function parseBool(v: string): boolean {
  return v === 'true' || v === 'yes' || v === '1';
}

function parseColor(v: string): Rgba {
  const parts = v.trim().split(/\s+/).map(parseReal);
  const ch = (i: number, fallback: number) =>
    Number.isFinite(parts[i]) ? parts[i] : fallback;
  return { r: ch(0, 0), g: ch(1, 0), b: ch(2, 0), a: ch(3, 1) };
}

/** Unknown strings fall back to 'one', as the original getBlendMode. */
function parseBlend(v: string): BlendFactor {
  return (BLEND_FACTORS as readonly string[]).includes(v) ? (v as BlendFactor) : 'one';
}

/** Anything but 'ridged' is 'fbm', as the original. */
function parseNoiseType(v: string): NoiseType {
  return v === 'ridged' ? 'ridged' : 'fbm';
}

function parseRamp(v: string, clampT: boolean): RampStop[] | undefined {
  const stops: RampStop[] = [];
  for (const part of v.split(';')) {
    const nums = part.trim().split(/\s+/).map(parseReal);
    if (nums.length < 4) continue;
    stops.push({
      t: clampT ? clamp01(nums[0]) : Math.max(0, nums[0]),
      color: { r: nums[1], g: nums[2], b: nums[3], a: Number.isFinite(nums[4]) ? nums[4] : 1 },
    });
  }
  return stops.length >= 2 ? stops : undefined;
}

function fmtRamp(stops: RampStop[]): string {
  return stops
    .map((s) => `${fmtReal(s.t)} ${fmtReal(s.color.r)} ${fmtReal(s.color.g)} ${fmtReal(s.color.b)} ${fmtReal(s.color.a)}`)
    .join('; ');
}

/** Validate an in-memory (JSON) ramp value; undefined if unusable. */
function coerceRamp(v: unknown, clampT = true): RampStop[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const stops: RampStop[] = [];
  for (const entry of v) {
    const e = entry as Partial<RampStop> | null;
    const c = (typeof e?.color === 'object' && e.color !== null ? e.color : {}) as Partial<Rgba>;
    const t = typeof e?.t === 'number' && Number.isFinite(e.t)
      ? (clampT ? clamp01(e.t) : Math.max(0, e.t))
      : null;
    if (t === null) continue;
    stops.push({
      t,
      color: {
        r: coerceNumber(c.r, 0),
        g: coerceNumber(c.g, 0),
        b: coerceNumber(c.b, 0),
        a: coerceNumber(c.a, 1),
      },
    });
  }
  return stops.length >= 2 ? stops : undefined;
}

function parseField(kind: FieldKind, v: string): unknown {
  switch (kind) {
    case 'real': return parseReal(v);
    case 'real01': return clamp01(parseReal(v));
    case 'int': return Math.trunc(parseReal(v));
    case 'bool': return parseBool(v);
    case 'color': return parseColor(v);
    case 'blend': return parseBlend(v);
    case 'noiseType': return parseNoiseType(v);
    case 'string': return v;
    case 'ramp': return parseRamp(v, true);
    case 'palette': return parseRamp(v, false);
    case 'stringList': {
      const items = v.split(';').map((s) => s.trim()).filter(Boolean);
      return items.length ? items : undefined;
    }
  }
}

// ------------------------------------------------------------- formatting

/** ~ Ogre StringConverter::toString(Real): 6 significant digits. */
function fmtReal(x: number): string {
  if (!Number.isFinite(x)) return '0';
  return String(Number(x.toPrecision(6)));
}

function fmtField(kind: FieldKind, v: unknown): string {
  switch (kind) {
    case 'real':
    case 'real01':
      return fmtReal(v as number);
    case 'int': return String(Math.trunc(v as number));
    case 'bool': return v ? 'true' : 'false';
    case 'color': {
      const c = v as Rgba;
      return `${fmtReal(c.r)} ${fmtReal(c.g)} ${fmtReal(c.b)} ${fmtReal(c.a)}`;
    }
    case 'blend':
    case 'noiseType':
    case 'string':
      return String(v);
    case 'stringList':
      return (v as string[]).join('; ');
    case 'ramp':
    case 'palette':
      return fmtRamp(v as RampStop[]);
  }
}

// ----------------------------------------------------- param <-> Layer

const LAYER_TYPES: readonly LayerType[] = [
  'noise', 'points', 'billboards', 'volumetric', 'galaxy', 'sun', 'planet', 'blackhole', 'sprite',
];

export interface ImportResult {
  layers: Layer[];
  /** Params we didn't recognize (kept out of the model, reported for triage). */
  warnings: string[];
}

/** Build a typed Layer from a flat name/value record (legacy param list). */
export function layerFromParams(params: Record<string, string>, warnings: string[] = []): Layer {
  // The original defaults a missing/unknown <type> to points (loadConfigFile).
  const raw = params['type'];
  const type: LayerType = LAYER_TYPES.includes(raw as LayerType) ? (raw as LayerType) : 'points';
  if (raw !== undefined && !LAYER_TYPES.includes(raw as LayerType)) {
    warnings.push(`unrecognized layer type ${JSON.stringify(raw)} treated as points`);
  }

  const layer = defaultLayer(type, params['name'] ?? 'Layer') as unknown as Record<string, unknown>;
  const fields = FIELDS[type];
  const optional = OPTIONAL[type];

  for (const [key, value] of Object.entries(params)) {
    if (key === 'type' || key === 'name') continue;
    const kind = fields[key] ?? optional[key];
    if (!kind) {
      warnings.push(`unknown param "${key}" on ${type} layer "${params['name'] ?? ''}"`);
      continue;
    }
    layer[key] = parseField(kind, value);
  }

  return layer as unknown as Layer;
}

/** Flatten a typed Layer back to the legacy name/value record. */
export function layerToParams(layer: Layer): Record<string, string> {
  const out: Record<string, string> = { type: layer.type, name: layer.name };
  const source = layer as unknown as Record<string, unknown>;

  for (const [key, kind] of Object.entries(FIELDS[layer.type])) {
    out[key] = fmtField(kind, source[key]);
  }
  for (const [key, kind] of Object.entries(OPTIONAL[layer.type])) {
    if (source[key] !== undefined) out[key] = fmtField(kind, source[key]);
  }
  return out;
}

// ------------------------------------------------------------- legacy XML

export function importLegacyXml(xmlText: string): ImportResult {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(`invalid Spacescape XML: ${error.textContent ?? 'parse error'}`);

  const warnings: string[] = [];
  const layers: Layer[] = [];

  for (const layerEl of Array.from(doc.getElementsByTagName('layer'))) {
    const params: Record<string, string> = {};
    for (const child of Array.from(layerEl.children)) {
      params[child.tagName] = child.textContent ?? '';
    }
    layers.push(layerFromParams(params, warnings));
  }

  return { layers, warnings };
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function exportLegacyXml(layers: Layer[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8" ?>', '<spacescapelayers>'];
  for (const layer of layers) {
    lines.push('    <layer>');
    const params = layerToParams(layer);
    // std::map ordering in the original => alphabetical
    for (const key of Object.keys(params).sort()) {
      lines.push(`        <${key}>${escapeXml(params[key])}</${key}>`);
    }
    lines.push('    </layer>');
  }
  lines.push('</spacescapelayers>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- JSON v2

export interface ProjectJson {
  version: 2;
  layers: Layer[];
}

export function toJsonString(layers: Layer[]): string {
  const project: ProjectJson = { version: 2, layers };
  return JSON.stringify(project, null, 2);
}

export function fromJsonString(text: string): ImportResult {
  const raw = JSON.parse(text) as Partial<ProjectJson>;
  if (raw.version !== 2 || !Array.isArray(raw.layers)) {
    throw new Error('not a Spacescape v2 project file');
  }

  const warnings: string[] = [];
  const layers: Layer[] = [];
  for (const entry of raw.layers) {
    const type = (entry as Layer | undefined)?.type as LayerType;
    if (!LAYER_TYPES.includes(type)) {
      warnings.push(`unknown layer type: ${JSON.stringify(type)}`);
      continue;
    }
    layers.push(normalizeLayer(entry as unknown as Record<string, unknown>, type));
  }
  return { layers, warnings };
}

const coerceNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Field-by-field validating merge over defaults, so hand-edited or
 * older/newer JSON files can never produce a structurally invalid layer
 * (e.g. a partial color object or a NaN that breaks XML export later).
 */
function normalizeLayer(entry: Record<string, unknown>, type: LayerType): Layer {
  const name = typeof entry['name'] === 'string' ? entry['name'] : 'Layer';
  const base = defaultLayer(type, name) as unknown as Record<string, unknown>;

  for (const [key, kind] of Object.entries(FIELDS[type])) {
    const v = entry[key];
    switch (kind) {
      case 'real':
        base[key] = coerceNumber(v, base[key] as number);
        break;
      case 'real01':
        base[key] = clamp01(coerceNumber(v, base[key] as number));
        break;
      case 'int':
        base[key] = Math.trunc(coerceNumber(v, base[key] as number));
        break;
      case 'bool':
        base[key] = typeof v === 'boolean' ? v : base[key];
        break;
      case 'color': {
        const d = base[key] as Rgba;
        const c = (typeof v === 'object' && v !== null ? v : {}) as Partial<Rgba>;
        base[key] = {
          r: coerceNumber(c.r, d.r),
          g: coerceNumber(c.g, d.g),
          b: coerceNumber(c.b, d.b),
          a: coerceNumber(c.a, d.a),
        };
        break;
      }
      case 'blend':
        base[key] = (BLEND_FACTORS as readonly unknown[]).includes(v) ? v : base[key];
        break;
      case 'noiseType':
        base[key] = v === 'ridged' || v === 'fbm' ? v : base[key];
        break;
      case 'string':
        base[key] = typeof v === 'string' ? v : base[key];
        break;
    }
  }

  for (const [key, kind] of Object.entries(OPTIONAL[type])) {
    const v = entry[key];
    if (v === undefined) continue;
    if (kind === 'ramp' || kind === 'palette') {
      const ramp = coerceRamp(v, kind === 'ramp');
      if (ramp) base[key] = ramp;
    } else if (kind === 'bool') {
      base[key] = typeof v === 'boolean' ? v : base[key];
    } else if (kind === 'stringList') {
      if (Array.isArray(v)) {
        const items = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
        if (items.length) base[key] = items;
      }
    } else {
      base[key] = kind === 'string' ? String(v) : coerceNumber(v, 0);
    }
  }

  return base as unknown as Layer;
}

// -------------------------------------------------- strict schema validation

/**
 * A single, human-readable schema problem. Unlike the lenient loader above
 * (which coerces or defaults dubious values so any file still opens), this
 * validation is strict so the Script editor can tell an AI agent exactly
 * which layer and field is wrong before the scene is applied.
 */
export interface SchemaIssue {
  message: string;
}

function jsType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function describeKind(kind: FieldKind): string {
  switch (kind) {
    case 'real':
    case 'real01':
      return 'a number';
    case 'int':
      return 'an integer number';
    case 'bool':
      return 'a boolean';
    case 'color':
      return 'a color object { r, g, b, a }';
    case 'blend':
      return 'a blend-factor string';
    case 'noiseType':
      return 'a noise-type string ("fbm" or "ridged")';
    case 'string':
      return 'a string';
    case 'ramp':
    case 'palette':
      return 'an array of ramp stops';
    case 'stringList':
      return 'an array of strings';
  }
}

/**
 * Deep per-kind check of a raw JSON value. Returns a clause describing the
 * first problem ("should be ..., got ..."), or null when the value is one the
 * loader would apply verbatim. Strictness matters here: the loader silently
 * coerces/clamps dubious values, so anything it would *change* is rejected
 * with a message instead of letting the editor accept text that doesn't
 * represent the applied scene.
 */
function kindIssue(kind: FieldKind, v: unknown): string | null {
  const mismatch = `should be ${describeKind(kind)}, got ${jsType(v)}`;
  switch (kind) {
    case 'real':
      return typeof v === 'number' && Number.isFinite(v) ? null : mismatch;
    case 'real01':
      if (typeof v !== 'number' || !Number.isFinite(v)) return mismatch;
      return v >= 0 && v <= 1 ? null : `should be within 0..1, got ${v}`;
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return mismatch;
      return Number.isInteger(v) ? null : `should be an integer, got ${v}`;
    case 'bool':
      return typeof v === 'boolean' ? null : mismatch;
    case 'color': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return mismatch;
      const c = v as Record<string, unknown>;
      for (const ch of ['r', 'g', 'b'] as const) {
        if (typeof c[ch] !== 'number' || !Number.isFinite(c[ch])) {
          return `color channel "${ch}" should be a number, got ${jsType(c[ch])}`;
        }
      }
      if (c['a'] !== undefined && (typeof c['a'] !== 'number' || !Number.isFinite(c['a']))) {
        return `color channel "a" should be a number, got ${jsType(c['a'])}`;
      }
      return null;
    }
    case 'blend':
      if (typeof v !== 'string') return mismatch;
      return (BLEND_FACTORS as readonly string[]).includes(v)
        ? null
        : `has unknown blend factor ${JSON.stringify(v)}. Valid: ${BLEND_FACTORS.join(', ')}`;
    case 'noiseType':
      return v === 'fbm' || v === 'ridged' ? null : `should be "fbm" or "ridged", got ${JSON.stringify(v)}`;
    case 'string':
      return typeof v === 'string' ? null : mismatch;
    case 'ramp':
    case 'palette': {
      if (!Array.isArray(v)) return mismatch;
      for (let j = 0; j < v.length; j++) {
        const e = v[j] as Record<string, unknown> | null;
        if (typeof e !== 'object' || e === null || Array.isArray(e)) {
          return `stop ${j} should be an object { t, color }, got ${jsType(e)}`;
        }
        if (typeof e['t'] !== 'number' || !Number.isFinite(e['t'])) {
          return `stop ${j}: "t" should be a number, got ${jsType(e['t'])}`;
        }
        const cIssue = kindIssue('color', e['color']);
        if (cIssue) return `stop ${j}: ${cIssue}`;
      }
      return null;
    }
    case 'stringList': {
      if (!Array.isArray(v)) return mismatch;
      for (let j = 0; j < v.length; j++) {
        if (typeof v[j] !== 'string') return `item ${j} should be a string, got ${jsType(v[j])}`;
      }
      return null;
    }
  }
}

/**
 * Validate a parsed (JSON.parse'd) value against the v2 project schema,
 * returning the first problem found or null when it is a well-formed scene.
 * Reuses the same FIELDS/OPTIONAL tables the loader normalizes against, so
 * there is no second schema to keep in sync.
 */
export function validateProjectJson(raw: unknown): SchemaIssue | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { message: 'Root must be a JSON object like {"version":2,"layers":[…]}.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 2) {
    return { message: `Expected "version": 2, got ${JSON.stringify(obj['version'])}.` };
  }
  if (!Array.isArray(obj['layers'])) {
    return { message: '"layers" must be an array.' };
  }

  for (let i = 0; i < obj['layers'].length; i++) {
    const entry = obj['layers'][i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { message: `Layer ${i}: must be an object.` };
    }
    const rec = entry as Record<string, unknown>;
    const name = typeof rec['name'] === 'string' ? rec['name'] : '(unnamed)';
    const type = rec['type'];
    if (typeof type !== 'string' || !LAYER_TYPES.includes(type as LayerType)) {
      return {
        message: `Layer ${i} ("${name}"): unknown layer type ${JSON.stringify(type)}. `
          + `Valid types: ${LAYER_TYPES.join(', ')}.`,
      };
    }

    const schema = { ...FIELDS[type as LayerType], ...OPTIONAL[type as LayerType] };
    for (const [key, value] of Object.entries(rec)) {
      if (key === 'type' || key === 'name') continue;
      const kind = schema[key];
      if (!kind) continue; // unknown field: ignored (forward-compatible), like the loader
      const problem = kindIssue(kind, value);
      if (problem) {
        return { message: `Layer ${i} ("${name}"): field "${key}" ${problem}.` };
      }
    }
  }

  return null;
}

// ----------------------------------------------------------- JSON schema

/**
 * Machine-readable JSON Schema (draft 2020-12) for the v2 scene document,
 * generated from the same FIELDS/OPTIONAL/LAYER_TYPES tables the loader and
 * validator use — one source of truth. Published at
 * https://skyboxeditor.com/schema/scene.v2.schema.json for AI-assisted scene
 * authoring; a snapshot test keeps the published file in sync.
 */
export function buildSceneJsonSchema(): Record<string, unknown> {
  const colorSchema = {
    type: 'object',
    properties: {
      r: { type: 'number' }, g: { type: 'number' },
      b: { type: 'number' }, a: { type: 'number' },
    },
    required: ['r', 'g', 'b'],
  };
  const kindSchema = (kind: FieldKind): Record<string, unknown> => {
    switch (kind) {
      case 'real': return { type: 'number' };
      case 'real01': return { type: 'number', minimum: 0, maximum: 1 };
      case 'int': return { type: 'integer' };
      case 'bool': return { type: 'boolean' };
      case 'color': return colorSchema;
      case 'blend': return { type: 'string', enum: [...BLEND_FACTORS] };
      case 'noiseType': return { type: 'string', enum: ['fbm', 'ridged'] };
      case 'string': return { type: 'string' };
      case 'ramp':
      case 'palette': return {
        type: 'array',
        items: {
          type: 'object',
          properties: { t: { type: 'number' }, color: colorSchema },
          required: ['t', 'color'],
        },
      };
      case 'stringList': return { type: 'array', items: { type: 'string' } };
    }
  };

  const layerVariants = LAYER_TYPES.map((type) => {
    const defaults = defaultLayer(type) as unknown as Record<string, unknown>;
    const properties: Record<string, unknown> = {
      type: { const: type },
      name: { type: 'string' },
    };
    const schema = { ...FIELDS[type], ...OPTIONAL[type] };
    for (const [key, kind] of Object.entries(schema)) {
      const prop = kindSchema(kind);
      if (defaults[key] !== undefined) prop['default'] = defaults[key];
      properties[key] = prop;
    }
    return {
      type: 'object',
      description: `"${type}" layer — omitted fields take their defaults`,
      properties,
      required: ['type'],
    };
  });

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://skyboxeditor.com/schema/scene.v2.schema.json',
    title: 'BinaryConstruct Skybox scene (v2)',
    description: 'Layer stack composited bottom-to-top onto the sky. '
      + 'Same-seed documents render identically (deterministic generation).',
    type: 'object',
    properties: {
      version: { const: 2 },
      layers: { type: 'array', items: { anyOf: layerVariants } },
    },
    required: ['version', 'layers'],
  };
}
