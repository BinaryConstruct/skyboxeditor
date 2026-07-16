---
task: Give positional layers full PCG generator parameter parity
status: draft
progress: 0/12
created: 2026-07-16
updated: 2026-07-16
---

## Problem

The PCG workbench and the positional layers evolved as separate paths and
have drifted: the PCG star baker has 16 styles (O–M spectral classes,
dwarfs, giants, pulsar, dust-ring, solar-system) but the `sun` layer exposes
only kelvin/limb/granulation/corona/prominences/glow; the PCG galaxy baker
has 6 morphologies (spiral, elliptical, edge-on, globular, interacting,
deep-field) but the `galaxy` layer renders only the spiral particle cloud;
the PCG planet baker has rocky/terran/gas styles with craters and clouds the
`planet` layer can't reach; the 10 anomaly styles (TDE, novae, quasar,
magnetar, …) have no layer type at all. Today the only bridge is bake → 
Sprites tab → drag, which loses parametric editability once placed.

## Goal

Every PCG generator capability is reachable as a first-class, re-editable
positional layer: the layer's Inspector exposes the same style + parameter
set as the PCG tab, rendering through the SAME baker functions, with one
spec-driven source of truth for params so the two paths cannot drift again.

## Out of Scope

- Nebula parity: `noise`/`volumetric` layers are cubemap-projected fields, a
  deliberately different medium from baked nebula sprites (which stay
  reachable via bake→sprite).
- Kerr/spinning black holes, or merging the anomaly `black-hole` style with
  the lensing `blackhole` layer (the lens layer stays its own thing).
- Batch/export changes beyond schema regeneration.
- Migrating old `.sspj`/`.xml` files to new fields (defaults must preserve
  their current look instead).

## Criteria

- [ ] C1: `sun` layer has a `style` field accepting all 16 PCG star styles
- [ ] C2: Sun layer render at style X equals `bakeSunGen` output at the same
      params (canvas pixel-compare in a vitest, one style per family)
- [ ] C3: `galaxy` layer has a `morphology` field with all 6 PCG values
- [ ] C4: Non-spiral galaxy morphologies render as placeable baked quads;
      `spiral` keeps the existing 3D particle-cloud path byte-identically
- [ ] C5: `planet` layer exposes `style` (rocky/terran/gas), `craters`,
      `clouds`, matching `bakePlanetGen` semantics
- [ ] C6: New `anomaly` layer type: positional quad baking `bakeAnomalyGen`
      with all 10 styles and their per-style params, draggable + lockable
- [ ] C7: Inspector groups for sun/planet/galaxy/anomaly are GENERATED from
      the same param-spec tables the PCG tab uses (single definition per
      param: label, range, default, per-style visibility)
- [ ] C8: io.ts FIELDS/OPTIONAL for these layers derive from the shared spec
      (or are asserted equal to it in a test) — no hand-maintained duplicate
- [ ] C9: JSON schema regenerated; Script tab validates the new fields with
      per-style enums listed in error messages
- [ ] C10: Layer bakes reuse the apparentSize-scaled resolution tiers and the
      dither/window/bodyAlpha finishing pipeline (occluding styles occlude)
- [ ] C11: Anti: every preset and the legacy golden scenes render unchanged
      (new fields default to the current behavior; determinism suite green)
- [ ] C12: Anti: no per-frame cost regression — bakes happen at layer build,
      never in the render loop; no Math.random anywhere new

## Decisions

- 2026-07-16: Plan drafted; architecture direction is "layers wrap bakers":
  `buildSunLayer`/`buildPlanetLayer` already call `bakeSunGen`/`bakePlanetGen`
  with a hardcoded param subset — parity means widening the layer schema and
  the mapping, not new renderers. Galaxy is the exception (two render modes
  behind one layer type). Anomaly is a new baked-quad layer type sharing the
  sprite-quad plumbing (`spriteQuad`, drag, lock).
- 2026-07-16: Param-spec single source of truth is the existing pcgSpec
  descriptor framework (`src/gen/pcgSpec.ts` / `pcgLayers.ts`) — extend it to
  carry io field kinds + Inspector metadata rather than inventing a new table.

## Verification

(criterion → probe, filled in as work lands)

## Phasing (suggested)

1. **Spec plumbing** (C7, C8): teach pcgSpec descriptors to emit io field
   kinds + Inspector control metadata; assert io tables match in a test.
2. **Sun styles** (C1, C2, C10): widen SunLayer, map through to bakeSunGen,
   spec-driven Inspector group, pixel-compare test.
3. **Planet styles** (C5): same pattern, small.
4. **Anomaly layer** (C6): new type, io + schema + LayerList button + presets
   hook; reuses sprite-quad placement.
5. **Galaxy morphologies** (C3, C4): dual-mode render (particle cloud vs
   baked quad), the only structurally new piece.
6. **Schema/docs sweep** (C9, C11, C12): regen schema, preset render pass,
   update the skybox-scenes skill with the new enums.
