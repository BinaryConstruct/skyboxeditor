---
task: PCG workbench tab — star/galaxy/nebula/planet generators with bake modes
status: complete
progress: 12/12
created: 2026-07-15
updated: 2026-07-15
---

## Problem

The Stars tab (PCG workbench, added G2–G4) generates flares, galaxies,
planets, and nebulas, but: the modes aren't named per the product intent
(star / galaxy / nebula / planet); bakes are full-color only, so a baked
sprite can't be tinted by a flare layer's color the way the bundled white
flares can; dark nebula lanes bake as dark-on-black, which is invisible under
the additive blending flare layers default to; the planet generator lacks the
rings documented in MODERNIZATION.md Phase 3a; the star generator has no
color control; and the Sprites/Stars tabs can show a horizontal scrollbar.

## Goal

Every generator mode (star, galaxy, nebula, planet) has purpose-built
controls, a live preview that matches the bake, and a Bake button offering
full-color, lightness-only (tintable), and dark-multiply output — with the
dark output actually able to darken the sky through the existing layer blend
factors.

## Out of Scope

- Positional celestial layers (sun, binary star, planet-in-sky, black-hole
  lensing) — MODERNIZATION.md Phase 3a v2, tracked separately.
- Batch seed export and per-layer/data export (tasks #1, #2).
- Sun-with-corona generator mode (queued as its own task).
- Any change to the legacy layer render pipeline or export contract.

## Criteria

- [x] C1: Workbench offers exactly star, galaxy, nebula, planet modes
- [x] C2: Each mode shows its own control set (no shared-param leakage)
- [x] C3: Bake offers full color, lightness only, and dark (multiply) modes
- [x] C4: Lightness bake yields grayscale pixels (R=G=B) preserving luminance
- [x] C5: Dark bake inverts luminance: empty space white, dense cloud dark
- [x] C6: Preview reflects the selected bake mode before baking
- [x] C7: Planet generator renders optional banded rings (inner/outer radius, tilt, color)
- [x] C8: Star generator supports blackbody color-temperature tint
- [x] C9: Sprites and Stars tabs scroll vertically only at 320px sidebar width
- [x] C10: Anti: no Math.random in src/gen — bakes stay seed-deterministic
- [x] C11: Anti: existing test suite stays green (59 tests pre-change)
- [x] C12: Anti: baked-sprite flow unchanged — bakes still land in sprite store / .sspj / texture pickers

## Decisions

- 2026-07-15: Dark-lane support = inverted-luminance bake + the layer engine's
  existing `dest_colour`/`zero` (multiply) blend factors — no new blend
  plumbing needed; a UI hint tells the user which factors to set.
- 2026-07-15: Bake-mode pixel transform implemented as a pure exported
  function so it is unit-testable without canvas (jsdom has no 2D context).
- 2026-07-15: When rings are enabled the planet radius shrinks by ringOuter so
  the ring system fits the sprite; deterministic ring banding comes from the
  planet's existing seeded Perlin instance.
- 2026-07-15: `pillars` nebula style removed at the user's direction: pillars
  are an inner structure of an emission nebula (Pillars of Creation ≈ 4–5 ly
  inside the ~70 ly Eagle Nebula), so a standalone pillar sprite reads wrong
  at sprite scale. Nebula styles are now nursery / dark-dust / wisp / shell —
  C4's "5 research-based styles" superseded accordingly.
- 2026-07-15: Codex review found two real defects, both fixed: (1) ring bands
  carried opacity in alpha, which additive (one/one) layer blending ignores —
  planet bakes are now flattened onto opaque black so alpha folds into RGB,
  matching the bundled flares' contract; (2) dark-multiply sprites are only
  neutral when the flare layer's colors are white (the material multiplies
  texture × layer color before dest_colour/zero) — the UI hint now says so.

- 2026-07-16: Sprite-quality pass (user feedback): (1) solid bodies are now
  opaque while their surroundings stay transparent — shared bodyAlpha()
  reconstruction (opaque disc + luminance-alpha corona/rings/atmosphere) on
  both positional sun and planet, sun default blend changed to
  one/one_minus_src_alpha so stars can't shine through the photosphere;
  (2) sun and planet disc edges are antialiased with a ~1.5px coverage band
  (fixing this exposed a NaN bug: pow(negative, 1.3) in the halo falloff
  painted a black ring in the AA band); (3) windowSpriteEdges() in genCommon
  radially fades every workbench bake to zero before the canvas edge —
  applied to all generator kinds in preview and bake, plus the positional
  builders — so galaxies/coronas can never clip into a hard box boundary.
  The multi-layer body/atmosphere split proper arrives with the pcgSpec
  content phase; bodyAlpha gives correct opacity semantics until then.

## Verification

All UI evidence gathered by driving the built app (vite preview, port 4189)
with Playwright on 2026-07-15; screenshots taken of the live `img.gen-preview`
element.

- C1: StarsTab.tsx Type options — `{ value: 'flare', label: 'star' }, { value: 'galaxy', … }, { value: 'nebula', … }, { value: 'planet', … }` (exactly four).
- C2: each mode's controls render under `{kind === '…' && (<Group …>)}` guards — StarsTab.tsx lines 78–160.
- C3: Bake group `SelectField label="Output"` with options `full color` / `lightness only` / `dark (multiply — dark lanes)`.
- C4: `generators.test.ts` — "lightness mode produces grayscale preserving Rec.709 luminance": red pixel → 54/54/54; vitest run: `Tests 62 passed (62)`.
- C5: test "dark mode inverts luminance…": black → 255, red → 201, all alpha forced 255; plus screenshot `nebula-dark.png` (white sky, dark cloud).
- C6: preview `useMemo` depends on `bakeMode` and calls `applyBakeModeToCanvas`; screenshots `nebula-dark.png` / `nebula-lightness.png` taken from the preview element, not a bake.
- C7: screenshot `planet-rings.png` — banded rings occluded behind the disc on the far side, in front on the near side, at ringAmount 0.85.
- C8: screenshots `star-3000k.png` (orange) and `star-15000k.png` (blue) after driving the Temp K slider.
- C9: in-page probe on both tabs after the `minmax(0,1fr)` grid fix: `Stars {"scrollW":287,"clientW":287,"overflowX":"hidden"}`, `Sprites {"scrollW":287,"clientW":287,"overflowX":"hidden"}` — no horizontal overflow at all.
- C10: `rg -n "Math.random" src/gen src/render src/core` → no matches (exit 1).
- C11: `vitest run` → `Test Files 6 passed (6), Tests 62 passed (62)` (59 pre-existing + 3 new).
- C12: `bake()` unchanged apart from the mode transform — still `addSpriteAsset(fileName, …)` → sprite store / .sspj / texture pickers.
