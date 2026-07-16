---
task: Per-layer + data export — separated layers, composite.json, stars-as-data
status: complete
progress: 13/13
created: 2026-07-15
updated: 2026-07-15
---

## Problem

VISION.md pillar 3: a flat baked skybox can't give engines separated nebula
layers to re-blend, or star positions to feed Niagara / GPUParticles /
MultiMesh. MODERNIZATION.md Phase 4 specifies per-layer asset export with a
composite.json sidecar and point-star layers as data, but the export panel
only bakes the composited result.

## Goal

One checkbox in the export panel produces a zip: every visible layer baked
solo as its own equirect image, star-bearing layers (points, billboards,
galaxy) additionally exported as JSON + CSV data in engine-neutral units,
and a composite.json recording layer order, types, and blend factors so the
original look is reproducible from the parts.

## Out of Scope

- Noise value in the alpha channel (layers export as rendered-on-black RGB;
  additive re-composition per composite.json reproduces the look).
- Combining per-layer with batch variations in one zip.
- Engine-side import scripts/plugins.

## Criteria

- [x] C1: Export panel offers a "Per-layer + data" option
- [x] C2: Zip holds one equirect PNG per visible renderable layer, index-prefixed
- [x] C3: composite.json records order, name, type, and src/dest blend factors per layer
- [x] C4: Points layers export positions (unit sphere), rgba colors, sizes as JSON and CSV
- [x] C5: Billboards layers export data too, with texture recorded in composite.json
- [x] C6: Galaxy layers export their 3D star cloud in sky-radius units
- [x] C7: Masked star layers export mask-respecting data (same path the renderer uses)
- [x] C8: JSON parses and CSV row count equals the JSON count (e2e probe)
- [x] C9: Per-layer .hdr images included when the HDR format is checked
- [x] C10: Anti: single and batch export outputs are unchanged when the option is off
- [x] C11: Anti: full test suite stays green (71 tests pre-change)
- [x] C12: Per-layer cube faces exported when "Cube faces" is checked
- [x] C13: Zip includes the fully flattened composite bake, referenced from composite.json

## Decisions

- 2026-07-15: Star data units — positions on/around the unit sky sphere
  (sky radius = 1); point sizes stay in source pixels, billboard sizes in
  sky-radius units; the JSON self-describes both so engines can scale.
- 2026-07-15: Data extraction lives on PreviewScene (layerStarData) so masked
  layers reuse the exact GPU mask path the renderer uses, instead of a
  CPU re-implementation that could drift.
- 2026-07-15: Galaxy placement basis (center/u/v/w) refactored out of
  buildGalaxyLayer and shared with the data export, so the exported cloud is
  the rendered cloud by construction.

## Verification

E2E on 2026-07-15: drove the built app (vite preview :4189) with Playwright,
checked "Per-layer + data (.zip)" at 512, captured
`purple-nebula-complex-layers-512.zip`, unzipped and probed with node.

- C1: export panel row "Per-layer + data (.zip)"; button becomes "Bake layers & data".
- C2: `layers/01-pink-purple-nebula-equirect.png` … `19-sparse-red-billboard-stars-equirect.png` — one per visible layer, index-prefixed slugs.
- C3: composite.json: `format: spacescape-web-composite`, 19 layers, real factors preserved — layer 3 shows `{"source":"one_minus_src_alpha","dest":"src_alpha"}`.
- C4: `data/02-large-purple-point-stars.json`: count 30000, `|p0| = 1.0000` (unit sphere), sizes present; CSV `x,y,z,r,g,b,a,size`.
- C5: 11 data pairs including billboards (`08-small-blue-billboard-stars`, count 25, sizeUnit sky-radius); composite.json records textures (flare-blue-purple2.png, flare-red1.png, …).
- C6: `layerStarData` galaxy branch shares `galaxyBasis()` with the render path; unit-based (Rg = apparentSize, |center| = 1). No galaxy layer in the test preset — code-probe only.
- C7: points/billboards branches call the same `bakeMask`/`generatePointsMasked`/`generateBillboards(mask)` the renderer uses (PreviewScene.layerStarData); the preset's masked billboard layers exported through it.
- C8: node probe — JSON parses, csv rows == count (30000/30000, 25/25) on all sampled layers.
- C9: `composite[i].imageHdr` + `.hdr` entry gated on the HDR checkbox (code probe; PNG-only run above has none, as selected).
- C10: per-layer runs only `if (exportPerLayer)`; single/batch branches untouched.
- C11: `vitest run` → Tests 76 passed (76) — 71 pre-existing + 5 new perLayer tests.
- C12/C13 (added when the user made cubemaps + flattened bake a requirement):
  second e2e run with "Cube faces" checked — zip holds 165 files:
  `layers/<stem>/posx…negz.png + equirect.png` per layer, `composite/` with 6
  faces + equirect, composite.json `composite` block quoted with all refs;
  `rg -c '"faces"'` → 20 (19 layers + 1 composite).
