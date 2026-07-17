# Execution Goal: Modern-Look Upgrade (M1–M6)

*2026-07-15. Implements the prioritized recommendations of
[MODERN-LOOK-RESEARCH.md](MODERN-LOOK-RESEARCH.md). Tracked as tasks M1–M6.*

**STATUS: COMPLETE (2026-07-15).** All milestones shipped, plus extras added
during execution: M7 procedural flares + hue populations, M8 sidebar tabs +
sprite uploads + .sspj project bundles, M9 per-star size ranges, export/bake
button (PNG/EXR/HDR), geosphere grid. Final parity gate:
purple-nebula-complex at defaults differs from the pre-upgrade reference by a
max channel delta of 3/255 (uniform quantization from the M3 half-float layer
pipeline — bakes now quantize at composite instead of at 8-bit bake), zero
structural drift. Notable discovery: the bundled 0.5.1 source is actually a
pre-HDR ~0.4 snapshot; hdrPower/hdrMultiplier/dataFile semantics were
recovered from upstream petrocket/spacescape (see M3/M5 commits).

**Goal:** escape the 2010 procedural look — filamentary structure, spectral
color, HDR highlights, volumetric depth, physical star colors — while keeping
every legacy `.xml` save rendering identically at default parameter values.

**Non-negotiable invariants (apply to every milestone):**
1. **Legacy parity:** all 6 bundled presets render byte-identical (or
   pixel-diff below noise threshold, documented) when new params sit at their
   defaults. New params default to "off".
2. **Export contract unchanged:** plain texture files for UE 5.8 / Godot 4;
   no engine plugins. New features must bake into the existing cubemap path.
3. **Determinism:** same seed + params → same output. No `Math.random()` in
   render/core paths (UI dice button excepted).
4. **Tests:** every core-level change lands with unit tests; shader changes
   land with a screenshot-diff check against a committed reference.

## Milestones

| # | Milestone | Depends on | Key acceptance test |
|---|---|---|---|
| M1 | Domain-warped FBM param (`warpStrength`/`warpScale`) on noise layers + masks | — | warp=0 → byte-identical purple-nebula-complex screenshot; warp>0 → filaments |
| M2 | Multi-stop color ramps + astro palettes (Hubble SHO, JWST NIR, Hα, reflection blue) | M1 | legacy 2-stop derived from inner/outer renders identically; ramp editor works |
| M3 | HDR half-float pipeline, `hdrPower`/`hdrMultiplier` semantics (fetch 0.5.x upstream source first), EXR + RGBE `.hdr` export, UE/Godot export profiles | — | `.hdr` imports as UE TextureCube; `.exr` drives Godot PanoramaSkyMaterial; hdr1.xml uses its HDR params |
| M4 | Raymarched pseudo-volumetric nebula layer type (emission ramp + Beer–Lambert absorption) | M1, M3 | new layer renders + composites; 1024 bake < 10 s; deterministic |
| M5 | Star-field physics: blackbody colors, magnitude distribution, galactic band; dust-lane bundled preset (recipe over existing blending) | — | defaults keep `generatePoints` byte-identical; existing tests untouched |
| M6 | Verification pass: parity gate on all presets, 3–4 showcase presets, codex review, docs update | M1–M5 | parity screenshots committed; showcase presets in gallery |

## Sequencing notes
- M1 → M2 → M3 is the high-payoff spine; each is independently shippable.
- M3 requires pulling the real 0.5.x source from
  github.com/alexcpeterson/spacescape (the bundled 0.2-era source lacks the
  HDR params) before implementing semantics — do not guess them.
- M4 is the flagship feature; start only after the M1 warp shader and M3
  half-float targets exist, since it builds on both.
- M5 is independent and can interleave anywhere.
- M6 gates "done": no milestone counts as complete for the goal until the
  parity screenshots and showcase presets are committed.

## Anti-goals (explicitly out of scope for this goal)
- Animated/time-evolving skies (separate roadmap phase).
- New positional object layers (galaxy/planet/sun/black hole — Phase 3a v2).
- WebGPU, code-splitting, hosting/PWA polish.
- Any engine-side plugin or material authoring.
