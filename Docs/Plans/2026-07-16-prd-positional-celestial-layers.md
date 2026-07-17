---
task: Positional celestial layers — sun, planet, black hole on the sky
status: complete
progress: 10/10
created: 2026-07-15
updated: 2026-07-15
---

## Problem

MODERNIZATION.md Phase 3a v2 calls for object layers placed on the sky
sphere (direction + apparent size) — sun, binary star, planet, black hole —
but the layer stack only had noise/points/billboards/volumetric/galaxy.
The black hole additionally needs a compositor capability that doesn't
exist: a distortion layer that bends the composite of the layers below it.

## Goal

Three new layer types — sun, planet, blackhole — placeable via lon/lat +
apparent size, editable in the Inspector, persisted in project JSON/.sspj,
included in bakes/exports, with the black hole gravitationally lensing the
layers beneath it in both preview and bake.

## Out of Scope

- A dedicated binary-star type: a binary is two sun layers (hint in the UI).
- Animated orbits (anti-goal: runtime skies; the tool bakes static skies).
- Auto-deriving planet lighting phase from a sun layer (manual light angle).
- Data export for these types (image-only layers; layerStarData → null).

## Criteria

- [x] C1: +sun / +planet / +b.hole buttons add working layers
- [x] C2: All three have Inspector controls (placement, type-specific groups)
- [x] C3: Sun renders the corona sprite at its sky position with no visible quad edge
- [x] C4: Planet occludes the sky behind its disc; rings/atmosphere stay translucent
- [x] C5: Black hole shows shadow, photon ring, and a lensed accretion disc
- [x] C6: The lens bends the layers below it (background visibly distorted)
- [x] C7: New types round-trip through project JSON (FIELDS/LAYER_TYPES entries)
- [x] C8: Bake path prepares distortion layers (capture runs in bakeExport too)
- [x] C9: Anti: existing layer types render unchanged; test suite green
- [x] C10: Anti: no Math.random in any new render path

## Decisions

- 2026-07-15: Sun and planet layers reuse the workbench bakers
  (bakeSunGen/bakePlanetGen) as CanvasTextures on origin-facing quads —
  one code path for sprite and positional looks.
- 2026-07-15: Planet occlusion via alpha reconstruction: sprite RGB is
  premultiplied (flattened onto black), so alpha = 255 inside the disc and
  max-channel elsewhere, blended one / one_minus_src_alpha by default.
- 2026-07-15: Black hole = lens quad sampling a CubeCamera capture of the
  scene (lens hidden) with a point-lens deflection (beta = theta - thetaE^2/theta,
  Rodrigues rotation), NoBlending so it replaces the background in its
  footprint; the additive disc is captured too, so the far side bends over
  the hole ("hat") for free. LayerObject gains an optional prepare() hook,
  run after every scene change and in bakeExport.
- 2026-07-15: Visual fixes after first screenshots: sun sprite windows all
  outside-disc light to zero before the canvas edge (quad boundary was
  visible); disc tilt semantics corrected (0 face-on, 90 edge-on); disc
  brightness halved and default disc temperature 4500 K (white blowout).
- 2026-07-15: vitest now excludes .claude/** — agent worktrees under the
  repo were double-running the suite.

## Verification

E2E on 2026-07-15 (vite preview :4189 + Playwright, screenshots of the live
viewport canvas over the purple-nebula-complex preset):

- C1/C2: +b.hole/+sun/+planet clicked through the real UI; Inspector sliders
  drove ring amount via the rendered controls.
- C3: `layer-sun.png` after the window fix — corona fades to nothing, no
  gray quad (first screenshot showed the defect; fix verified by re-shot).
- C4: `layer-planet.png` — ringed planet over the nebula, background visible
  around the sprite, disc opaque.
- C5/C6: `layer-blackhole.png` — black shadow, warm photon ring, tilted
  orange disc with the lensed far-side arc above/below the hole; nebula
  background distorted inside the lens footprint.
- C7: FIELDS/OPTIONAL/LAYER_TYPES extended for all three types (io.ts);
  TYPE_LABELS/App names records compile exhaustively.
- C8: bakeExport runs `o.prepare?.(renderer, bakeScene)` after assembling
  the bake scene.
- C9: vitest 76/76 green; existing presets render (screenshots show the
  untouched nebula/star layers behind the new objects).
- C10: `rg "Math.random" src/render src/core src/gen` → no matches.

## Post-completion additions (2026-07-16)

- All spherical-coordinate layers are now draggable: galaxy clouds re-aim by
  rotating their group about the origin (world-baked particles untouched),
  the black hole re-places lens/disc/proxy in place (bhDir uniform shares the
  mutated vector; the stale capture refreshes on the commit-time rebuild).
  Both grab through invisible pick-proxy quads sized to their footprint.
- `locked` (optional, on LayerCommon) + "Lock position" toggle in every
  Placement group: locked layers build without a placeable, so the viewport
  picker cannot grab them. Round-trips as an OPTIONAL bool (the JSON OPTIONAL
  path previously coerced booleans to numbers — fixed).
- Baked-lensing evidence: gargantua 512 equirect export shows the lens
  (shadow, photon ring, disc hat, bent star band) flattened into the
  panorama; drag verification moved galaxy lon 28→-1 and blackhole 15→-9 via
  scripted mouse drags, and a locked layer did not move.
