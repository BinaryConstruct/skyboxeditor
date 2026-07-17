/**
 * PCG object framework — the composable model from
 * Docs/Research/2026-07-16-stellar-objects-layer-guidance.md §5, adapted to this codebase's canvas-2D
 * sprite bakers: a celestial object is a classification + subtype + ordered
 * stack of reusable component layers, composed deterministically onto one
 * sprite canvas.
 *
 * This module owns the CONTRACT (specs, registry, validation, composition);
 * content recipes (stellar classes, anomalies, discs …) register themselves
 * against it in a later phase — see Docs/Plans/2026-07-16-pcg-stellar-styles.md.
 */

/** Canvas composite for a component layer's contribution. */
export type PcgBlendMode = 'add' | 'screen' | 'multiply' | 'alpha';

const BLEND_OPS: Record<PcgBlendMode, GlobalCompositeOperation> = {
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  alpha: 'source-over',
};

/** One reusable component layer instance inside a PCG object. */
export interface PcgLayerSpec {
  /** unique within the object; dependsOn refers to these */
  id: string;
  /** registered renderer type, e.g. 'photosphere', 'corona', 'ring-set' */
  type: string;
  enabled: boolean;
  /** layer-local seed; independent streams per layer by design */
  seed: number;
  blendMode: PcgBlendMode;
  params: Record<string, unknown>;
  /** layers whose output this one derives from (masks, centerlines, …) */
  dependsOn?: string[];
}

/** A complete PCG object: classification → subtype → component stack. */
export interface PcgObjectSpec {
  schemaVersion: 1;
  /** classification, e.g. 'star', 'galaxy', 'nebula', 'planet', 'anomaly' */
  classId: string;
  /** subtype within the class, e.g. 'g-class', 'pulsar', 'kilonova' */
  subtypeId: string;
  name: string;
  seed: number;
  layers: PcgLayerSpec[];
}

/**
 * A component-layer renderer draws its contribution onto a fresh transparent
 * canvas context; the framework composites it per blendMode. Renderers must
 * be deterministic in (layer.seed, layer.params, object.seed, size).
 */
export type PcgLayerRenderer = (
  ctx: CanvasRenderingContext2D,
  layer: PcgLayerSpec,
  object: PcgObjectSpec,
  size: number,
) => void;

const registry = new Map<string, PcgLayerRenderer>();

export function registerPcgLayerType(type: string, renderer: PcgLayerRenderer): void {
  registry.set(type, renderer);
}

export function pcgLayerTypes(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Dependency-respecting execution order (stable topological sort). Pure and
 * exported for tests; throws on cycles with a human-readable message.
 */
export function pcgExecutionOrder(layers: PcgLayerSpec[]): PcgLayerSpec[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const ordered: PcgLayerSpec[] = [];

  const visit = (l: PcgLayerSpec, chain: string[]) => {
    if (done.has(l.id)) return;
    if (visiting.has(l.id)) {
      throw new Error(`layer dependency cycle: ${[...chain, l.id].join(' -> ')}`);
    }
    visiting.add(l.id);
    for (const dep of l.dependsOn ?? []) {
      const target = byId.get(dep);
      if (target) visit(target, [...chain, l.id]);
    }
    visiting.delete(l.id);
    done.add(l.id);
    ordered.push(l);
  };

  for (const l of layers) visit(l, []);
  return ordered;
}

/** Human-readable spec problems; empty = valid. */
export function validatePcgObject(spec: PcgObjectSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const l of spec.layers) {
    if (ids.has(l.id)) errors.push(`duplicate layer id "${l.id}"`);
    ids.add(l.id);
    if (!registry.has(l.type)) errors.push(`unknown layer type "${l.type}" (layer "${l.id}")`);
    for (const dep of l.dependsOn ?? []) {
      if (!spec.layers.some((o) => o.id === dep)) {
        errors.push(`layer "${l.id}" depends on missing layer "${dep}"`);
      }
    }
  }
  try {
    pcgExecutionOrder(spec.layers);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}

/**
 * Compose an object spec into a sprite canvas: each enabled layer renders
 * onto its own transparent scratch canvas, then composites per blendMode in
 * dependency order. Bake modes / flattening apply downstream, exactly like
 * the existing single-recipe bakers.
 */
export function composePcgObject(spec: PcgObjectSpec, size: number): HTMLCanvasElement {
  const errors = validatePcgObject(spec);
  if (errors.length) throw new Error(`invalid PCG object: ${errors.join('; ')}`);

  const target = document.createElement('canvas');
  target.width = size;
  target.height = size;
  const out = target.getContext('2d')!;
  out.fillStyle = '#000';
  out.fillRect(0, 0, size, size);

  for (const layer of pcgExecutionOrder(spec.layers)) {
    if (!layer.enabled) continue;
    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const ctx = scratch.getContext('2d')!;
    registry.get(layer.type)!(ctx, layer, spec, size);
    out.globalCompositeOperation = BLEND_OPS[layer.blendMode];
    out.drawImage(scratch, 0, 0);
  }
  out.globalCompositeOperation = 'source-over';
  return target;
}
