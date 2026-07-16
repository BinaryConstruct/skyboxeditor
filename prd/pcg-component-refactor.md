---
task: PCG workbench refactor — component ring layers + new galaxy morphologies
status: complete
progress: 14/14
created: 2026-07-15
updated: 2026-07-15
---

## Problem

The Stars-tab planet generator carried a single hard-coded ring
(ringAmount/ringInner/ringOuter/ringTiltDeg/ringColor) — one ring, one tilt,
no in-plane rotation, no per-ring band seed. And the galaxy generator had
exactly one morphology (the spiral particle cloud), leaving the sky with no
smooth red-sequence ellipticals, no edge-on dust-lane needles, and no dense
point-swarm clusters — the three biggest coverage gaps called out in
docs/PCG-SAMPLES-RESEARCH.md §3.

## Goal

Generator output composes from stackable component layers (starting with
planetary rings: a planet can carry multiple independently tilted/rotated ring
sets), and the galaxy generator grows a `morphology` select whose new members
(elliptical/S0, edge-on disk, globular cluster, and a bonus interacting pair)
follow the research doc's analytic recipes — all deterministic from seed +
params, with the existing bake modes and "Bake to Sprites" flow untouched.

## Out of Scope

- Background galaxy sprinkle v2, galaxy-cluster ICM glow, flare `pattern`
  enum, planetary-nebula shell params (research §2.5/2.7/2.8/2.9) — future
  passes.
- Any change to the legacy layer render pipeline, export contract, or the
  non-planet/galaxy generators (star, sun, nebula) beyond shared-helper
  extraction.

## Criteria

- [x] C1: A planet carries `rings: RingParams[]` (0..N sets); the single-ring
      params are gone; DEFAULT_PLANET migrates to `rings: []`
- [x] C2: Each ring set has independent inner/outer/rotation/tilt/opacity/
      color/bandSeed
- [x] C3: Ring occlusion preserved — far half behind planet+atmosphere, near
      half in front — and rotates with each set's line of nodes
- [x] C4: G8 atmosphere draw-order fix preserved ('screen' atmosphere drawn
      before rings)
- [x] C5: Planet UI has "+ ring" / "remove" and an editable group per set
- [x] C6: Galaxy gains `morphology` = spiral | elliptical | edge-on |
      globular | interacting; spiral path byte-for-byte unchanged
- [x] C7: Elliptical uses an analytic Sérsic profile — smooth concentrated
      falloff, red-sequence palette, no structural noise
- [x] C8: Edge-on uses sech² disk + Sérsic bulge + exponential dust-lane
      silhouette that darkens *and* reddens
- [x] C9: Globular uses a Plummer draw + King tidal cutoff — unresolved core
      glow + resolved outskirt speckle
- [x] C10: Interacting pair (bonus) — restricted three-body tails/bridge
- [x] C11: Stable exports preserved (bakeGalaxyGen/bakePlanetGen/…, GEN_SIZE,
      DEFAULT_*, *GenParams/BakeMode types); param interfaces extended only
      with optional fields or `rings`
- [x] C12: Anti — no Math.random in src/gen; bakes stay seed-deterministic
- [x] C13: Anti — `npm test` green, `npm run build` clean, `npm run lint` no
      new warnings in changed files
- [x] C14: Anti — bake modes (color/lightness/dark) + "Bake to Sprites" flow
      unchanged for every mode

## Decisions

- 2026-07-15: Shared canvas helpers (makeCanvas/cssRgba/flattenOntoBlack/
  GEN_SIZE) extracted to `src/gen/genCommon.ts` so galaxyMorph.ts and
  generators.ts build sprites on the same opaque-black, alpha-folded contract.
  GEN_SIZE is re-exported from generators.ts to keep that stable export.
- 2026-07-15: Analytic profiles (Sérsic, sech², Plummer inverse-CDF, King
  weight) live in `src/gen/profiles.ts` as pure functions so they unit-test
  without a 2D context (vitest runs node env; jsdom has no real canvas).
- 2026-07-15: Ring rotation implemented by rotating the context to the ring's
  line of nodes, then clipping rotated-frame top/bottom halves — the existing
  destination-over (far) / source-over (near) occlusion carries over unchanged
  and now tracks each set's rotation.
- 2026-07-15: The single-ring legacy fields were dropped rather than kept as a
  fallback — the only call sites (generators.ts, StarsTab.tsx) are in scope,
  and DEFAULT_PLANET's ringAmount was 0, so migrating to `rings: []` preserves
  the current visual output (no rings by default).
- 2026-07-15: Galaxy morphology added as an optional field defaulting to
  'spiral'; new per-morphology params are all optional with defaults in
  DEFAULT_GALAXY, so existing DEFAULT_GALAXY callers and the spiral bake are
  untouched.
- 2026-07-15: Interacting pair kept as the recommended restricted three-body
  (Toomre) integrator — deterministic leapfrog, ~3200 particles, well under
  1 s. At default params it reads as two cores joined by a tidal bridge; it is
  a bonus morphology, not one of the three required.

## Verification

Pure-math and pixel-transform criteria verified by `vitest run`; visual
criteria by rendering the real bake functions on a Vite dev server and
screenshotting with Playwright (chromium), plus a smoke test driving the
actual StarsTab UI. Scratch harness/scripts deleted after capture; dev server
killed.

- C1/C2: `PlanetGenParams.rings: RingParams[]`, `RingParams` =
  {inner, outer, rotationDeg, tiltDeg, opacity, color, bandSeed};
  `DEFAULT_PLANET.rings = []`. No ringAmount/ringInner/... anywhere
  (`rg -n "ringAmount|ringInner|ringOuter|ringTiltDeg|ringColor" src` → only
  this doc / historical pcg-workbench.md).
- C3: screenshot of a 2-ring planet (inner tilt 20° rot 0°, outer tilt 62°
  rot 55°) — inner ring's near arc crosses in front of the disc, far arc is
  occluded behind it; the outer steeply-tilted ring passes correctly in
  front/behind at its own rotated node line.
- C4: `bakePlanetGen` still draws the 'screen' atmosphere rim before the ring
  loop; screenshot shows the blue atmosphere glow with near-side rings over it
  and no white blow-out.
- C5: Playwright smoke — clicking "+ ring" twice yields "Ring 1"/"Ring 2"
  editable groups each with a remove button; `getByText('Ring 2')` present.
- C6: `bakeGalaxyGen` switches on `p.morphology`; the `default` branch falls
  through to the original particle path unchanged. UI Morphology select sweeps
  all five options against the live `img.gen-preview`.
- C7: elliptical screenshot — smooth gold oval, concentrated core, large soft
  halo, faint speckle, ±low-freq asymmetry, no arm/band structure.
- C8: edge-on screenshot — thin bright disk with a central Sérsic bulge and a
  distinct dark, reddened dust-lane silhouette cutting the midplane;
  radially truncated tips.
- C9: globular screenshot — bright unresolved core glow with hundreds of
  resolved point stars, strong central concentration falling to sparse
  speckle at the tidal edge, cream with a few blue stragglers.
- C10: interacting screenshot — two cores (primary + companion) joined by a
  tidal bridge of test particles with disturbed outskirts.
- C11: `npx tsc -b` exit 0 (all in-scope call sites compile); stable exports
  present; galaxy/planet param interfaces extended only with optional fields /
  the `rings` array.
- C12: `rg -n "Math.random" src/gen` → no matches. All randomness via MsvcRng /
  PerlinNoise seeded from the params.
- C13: `vitest run` → Test Files 9 passed, Tests 85 passed (76 pre-existing +
  9 new profile tests). `npm run build` → built clean. `npm run lint` → the
  only warnings are pre-existing and in files this task did not touch.
- C14: `applyBakeMode`/`applyBakeModeToCanvas` and the StarsTab bake()/preview
  paths are unchanged apart from the new generators feeding them; the three
  existing applyBakeMode tests still pass.
