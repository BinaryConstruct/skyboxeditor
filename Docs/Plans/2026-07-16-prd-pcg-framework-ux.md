---
task: PCG framework UX — first-class tab, viewport preview, draggable sky quads
status: complete
progress: 12/12
created: 2026-07-16
updated: 2026-07-16
---

## Problem

The PCG workbench previews into a 288px sidebar thumbnail, and placing a
baked object in the sky means adding a flares layer and fighting scatter
parameters. The user wants the framework in place BEFORE the stellar-styles
content lands (docs/PCG-STELLAR-STYLES-PLAN.md + docs/StellarObjects.md):
PCG as a first-class tab that previews in the main viewport, and baked
objects (or uploaded imagery) placeable on the sky sphere as directly
manipulable quads.

## Goal

A generic sprite quad layer (texture, spherical placement, size, stretch,
rotation) that renders in preview and bakes, drag-to-place in the viewport;
the PCG tab previews its current generator full-size in the main viewport
over the skybox or black; one click adds a bake to the skybox as a sprite
layer.

## Out of Scope

- The stellar-styles content itself (classifications/subtypes beyond what
  exists) — explicitly deferred by the user until this framework lands.
- Dragging galaxy/black-hole layers (their geometry is world-baked; they
  keep slider placement).
- Free 3D placement off the sphere (quads stay at sky radius by design).

## Criteria

- [x] C1: New sprite layer type: texture id, dirLon/dirLat, apparentSize, aspect, rotationDeg, blend factors
- [x] C2: Sprite layers render in the live preview and in bakes/exports
- [x] C3: Inspector edits all sprite fields; texture picker includes bundled, procedural, and user/baked sprites
- [x] C4: Dragging a sprite/sun/planet quad in the viewport moves it on the sphere; release commits lon/lat
- [x] C5: Orbit look-around still works when the drag doesn't start on a positional quad
- [x] C6: PCG tab renders its generator preview as a quad in the main viewport, updating live with param edits
- [x] C7: Backdrop toggle: preview over the current skybox or over black
- [x] C8: "Add to skybox" after a bake creates a sprite layer using the baked texture at the view center
- [x] C9: Workbench tab presents as PCG with mode (classification) + Style structure
- [x] C10: Sprite layers round-trip project JSON (FIELDS/LAYER_TYPES/OPTIONAL entries)
- [x] C11: Anti: existing presets render unchanged; full test suite stays green
- [x] C12: Anti: leaving the PCG tab removes the preview quad and restores the skybox backdrop

## Decisions

- 2026-07-16: Drag model — pointerdown raycasts positional quads; a hit
  captures the pointer and suspends OrbitControls; while dragging, the mesh
  is re-placed via a cheap place() hook (no rebuild); pointerup commits
  lon/lat through the normal updateLayer path (so black-hole captures etc.
  refresh once, not per-move).
- 2026-07-16: Viewport PCG preview is an additive quad (black sprite
  background disappears over the sky; the black-backdrop toggle gives the
  exact bake view).

- 2026-07-16: Composable-object contract added as src/gen/pcgSpec.ts per the
  user-supplied docs/StellarObjectResearch2.md §5 (classification → subtype →
  reusable component layers with blend modes, dependencies, cycle-checked
  execution order). Content recipes register against it in the next phase;
  the existing single-recipe bakers keep working unchanged meanwhile.
- 2026-07-16: Codex review, six findings fixed: drag now tracks pointerId and
  ends on pointercancel/lostpointercapture (navigation could lock up);
  legacy-XML import recognized only four layer types, silently corrupting
  sun/planet/blackhole/sprite into points; lens captures now always render
  the sky even while the PCG backdrop hides it, and the async recapture path
  shares the same pcg-quad-excluding capture routine; a completed drag now
  cancels any pending slider debounce for that layer; sprite-asset changes
  rebuild layers referencing user textures.

## Verification

E2E on 2026-07-16 (built app on :4189, Playwright driving the real UI with
mouse events; screenshots read back):

- C1/C10: SpriteLayer in layers.ts + io FIELDS/OPTIONAL/LAYER_TYPES entries;
  build compiles all exhaustive LayerType records.
- C2: buildSpriteLayer via loadFlareTexture (bundled/proc:/user:); the added
  bake rendered in the live viewport (`ux-sprite-added.png`); bake path uses
  the same buildLayer switch.
- C3: SpriteControls (texture select incl. ⬆ user sprites, lon/lat/size/
  stretch/rotation) rendered when the added layer was selected.
- C4: scripted mouse drag on the quad: longitude slider read 0 before, 24.99
  after (`lon before drag: 0`, `lon after drag: 24.99 | moved: true`);
  `ux-sprite-dragged.png` shows the galaxy moved up-right on the sphere.
- C5: drag starts only when the capture-phase pointerdown raycast hits a
  placeable quad; otherwise OrbitControls receives the event untouched.
- C6: `ux-pcg-over-sky.png` — the current generator (spiral galaxy) shown
  full-size in the main viewport over the purple-nebula-complex sky.
- C7: `ux-pcg-black.png` — same object on pure black after unchecking
  "Show skybox".
- C8: Bake → "Add to skybox" button created layer `sprite test-object`
  (layer-list row quoted in the probe output) at the view center.
- C9: tab renders as "PCG"; modes + Style structure unchanged inside.
- C11: vitest 85/85; the preset skies in all screenshots render normally.
- C12: the add-to-sky flow switches to the Layers tab — `ux-sprite-added.png`
  shows the sky restored with no preview quad.
