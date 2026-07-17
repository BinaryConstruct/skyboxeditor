# Epic List

High-level goals, status, and current focus. Update whenever a goal is
added, completed, blocked, materially descoped, or superseded.

**Current focus:** Layer/PCG consolidation
([plan](Plans/2026-07-16-prd-layer-pcg-consolidation.md)) — awaiting go.

## Shipped

- **E1 — Spacescape rewrite core** ✅ Layer stack (nebula, volumetric,
  stars, flares), legacy `.xml` import with byte-exact determinism, `.sspj`
  native format, cubemap/equirect/HDR/EXR export.
  [Design/ARCHITECTURE-MODERNIZATION.md](Design/ARCHITECTURE-MODERNIZATION.md),
  [Blog/2026-07-16-execution-modern-look.md](Blog/2026-07-16-execution-modern-look.md)
- **E2 — PCG workbench** ✅ Parameterized star/galaxy/nebula/planet/anomaly
  generators, bake modes (color/lightness/dark), bake-to-sprites.
  [Plans/2026-07-16-prd-pcg-workbench.md](Plans/2026-07-16-prd-pcg-workbench.md),
  [Plans/2026-07-16-pcg-stellar-styles.md](Plans/2026-07-16-pcg-stellar-styles.md)
- **E3 — Positional celestial layers** ✅ Sun/planet/sprite quads with
  spherical placement, drag-to-place, lock; black-hole lens layer.
  [Plans/2026-07-16-prd-positional-celestial-layers.md](Plans/2026-07-16-prd-positional-celestial-layers.md)
- **E4 — Exports** ✅ Per-layer + data export, flattened composite,
  deterministic batch variations.
  [Plans/2026-07-16-prd-per-layer-data-export.md](Plans/2026-07-16-prd-per-layer-data-export.md),
  [Plans/2026-07-16-prd-batch-seed-export.md](Plans/2026-07-16-prd-batch-seed-export.md)
- **E5 — Geodesic black holes** ✅ Planar Schwarzschild integrator; PCG
  sprite traced per pixel; lens layer with deflection LUT + analytic disc
  (Luminet double-loop anatomy, Doppler min/max color).
  [Research/2026-07-16-blackhole-geodesics.md](Research/2026-07-16-blackhole-geodesics.md)
- **E6 — AI-authorable scenes** ✅ Script tab (live two-way JSON,
  line-precise errors), published JSON schema, scene-authoring skill.
- **E7 — Ship it** ✅ BinaryConstruct branding, MIT license, AI policy,
  GitHub (`BinaryConstruct/skyboxeditor`) with `verify` CI gate + ruleset,
  Cloudflare Workers deploy — live at skyboxeditor.binaryconstruct.workers.dev.
  Remaining: attach the skyboxeditor.com custom domain (dashboard).

## In progress / next

- **E8 — Layer/PCG consolidation** 🔜 Positional layers gain full generator
  parity (16 sun styles, 6 galaxy morphologies, planet styles, new anomaly
  layer type), spec-driven from one param table.
  [Plans/2026-07-16-prd-layer-pcg-consolidation.md](Plans/2026-07-16-prd-layer-pcg-consolidation.md)

## Backlog / ideas

- PCG component-layer refactor follow-ups:
  [Plans/2026-07-16-prd-pcg-component-refactor.md](Plans/2026-07-16-prd-pcg-component-refactor.md)
- Stellar content expansion:
  [Plans/2026-07-16-prd-stellar-content.md](Plans/2026-07-16-prd-stellar-content.md)
- Bundle-size code-splitting (vite warns at ~1 MB main chunk).
