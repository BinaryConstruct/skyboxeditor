---
task: Stellar content expansion — sun styles, anomalies, composable layers, deep field
status: complete
progress: 7/7 phases
created: 2026-07-16
updated: 2026-07-16
---

## Problem

The PCG workbench (Stars/PCG tab) shipped with five generator modes but a thin
content library: one star flare, one sun recipe, five galaxy morphologies, four
nebula styles, one planet. `docs/StellarObjectResearch2.md` (§8 reusable layer
library, §9 object recipes) and `docs/PCG-STELLAR-STYLES-PLAN.md` (per-style
math, kelvin anchors, build order) describe a much larger, art-directable zoo —
spectral classes, dwarfs, giants, black holes, quasars, magnetars, kilonovae,
protoplanetary discs, JWST deep fields — plus a *composable* model where an
object is a stack of reusable component layers rather than a monolithic baker.
None of that was implemented, and the two variant selectors that existed used
inconsistent labels ("Morphology" vs "Style").

## Goal

Expand the workbench to the full content set in the plan, on the existing
canvas-2D deterministic baker architecture, without breaking any stable export,
the StarsTab props contract, or byte-stable default outputs:

1. one consistent **Style** selector per mode;
2. the O B A F G K M sequence + dwarfs/giants + star+disc composites (sun mode);
3. a new **anomaly** mode with 10 extreme-object styles;
4. the §8 reusable component layers registered against the pcgSpec framework;
5. a spec-driven editor where a PCG object is an editable layer stack;
6. a documented bridge between the sprite black hole and the positional one;
7. a JWST deep-field galaxy subtype.

## Out of Scope

- Any change to `src/render/**`, `src/core/**`, `src/export/**`, `src/App.tsx`,
  or UI files other than `StarsTab.tsx` — this is a content/gen expansion.
- Real gravitational lensing in a sprite (stays in the positional
  `blackHoleLayer`; the sprite BH is self-contained art — see Decisions).
- Time variability / animation (bakes are static; `phase`/`shellAge` params
  capture one moment instead).
- Resolved planet discs in `solar-system` (planets are 1–2 px points).
- A magnetosphere component layer (the magnetar dipole cage lives only in the
  legacy anomaly baker for now — see Follow-ups).

## Criteria

- [x] C1: Every mode's variant selector is labeled "Style"; galaxy keeps the
  serialized key `morphology` (only the UI label changed). (P1 f7ef02d)
- [x] C2: Sun mode offers O B A F G K M + white/red/brown dwarf +
  red/blue giant + red-supergiant + pulsar + dust-ring + solar-system, applied
  via `SUN_STYLE_DEFAULTS` presets. (P4 e8f2c60)
- [x] C3: The G-class style at defaults bakes byte-identically to the historic
  `DEFAULT_SUN` — every new code path (granuleScale, ambientWisp, spikes,
  giant mottle, rim, white-dwarf halo, coolCap whiteMix) gates to a no-op at
  G's parameters. Verified by construction + a G screenshot that matches the
  prior sun.
- [x] C4: `solar-system` renders a tilted protoplanetary disc with a geometric
  gap series (r_k = r0·g^k) and 1–2 px point planets in the gaps (HL Tau look).
  Screenshot verified.
- [x] C5: New `anomaly` mode bakes 10 styles: black-hole, tde, multiple, nova,
  supernova, kilonova, quasar, smbh-torus, magnetar, pulsar. (P5 622f030)
- [x] C6: Each anomaly style reads as its object under visual inspection:
  black-hole = shadow+photon-ring+Doppler-disc+hat; quasar = core+knotted
  jets+lobes; magnetar = dipole loop cage; pulsar = misaligned lighthouse
  beams+wind torus; smbh-torus = dusty doughnut+core; kilonova = blue
  poles+red torus; supernova = shock shell+filaments+rays; tde = spiral debris
  stream+spaghettified star; nova = core+young shell; multiple = binary+spikes.
  All screenshotted and iterated (smbh-torus fixed from side-blobs to a
  doughnut; brown-dwarf desaturation fixed).
- [x] C7: The §8 component layers are registered pcgSpec layer types with editor
  descriptors: photosphere, corona-streamers, prominence-arcs, glow-halo,
  accretion-disc, jet-pair, shell, star-scatter, dust-lane, diffraction-spikes,
  lens-art. (P2 38a6566)
- [x] C8: Pure component math is unit-tested — geometric gap series, dipole loop
  r = L·sin²θ, beam/hollow-cone profile, Doppler factor, and the OBAFGKM
  spectral/Wien ordering. (`src/gen/pcgMath.test.ts`, `pcgLayers.test.ts`)
- [x] C9: A PCG object = classification + subtype Style that seeds a component
  stack from a preset registry, with per-layer enable/disable, remove, reorder,
  and parameter editing; preview + bake go through composePcgObject via the
  existing viewport-preview and bake flow. (P3 bff28de)
- [x] C10: The legacy single-recipe modes still work unchanged; the PCG mode is
  additive (documented in Decisions).
- [x] C11: The anomaly black-hole subtype IS the PCG-editable BH sprite;
  bridge to the positional layer documented (P6, this PRD).
- [x] C12: A `deep-field` galaxy style scatters a typed, bimodally-colored
  mini-galaxy population for the JWST look. (P7 358e4a1)
- [x] C13: Anti — no `Math.random` in any gen path; all randomness flows from
  MsvcRng / PerlinNoise seeded streams. (`rg Math.random src/gen` empty)
- [x] C14: Anti — `npm test` green (105 tests), `npm run build` clean,
  `npm run lint` no new warnings (only the two pre-existing known warnings).
- [x] C15: Anti — stable exports unchanged: bakeFlareGen / bakeSunGen /
  bakeGalaxyGen / bakePlanetGen / bakeNebulaGen / applyBakeMode(ToCanvas) /
  GEN_SIZE / DEFAULT_* / *GenParams all extended, never broken.
- [x] C16: Anti — every new bake path stays edge-contained (StarsTab applies
  `windowSpriteEdges` to preview + bake for all modes, including anomaly and
  pcg; bakers stay window-free like the existing galaxy/nebula bakers).

## Decisions

- 2026-07-16: **Reordered vs the numbered phase list.** Shipped P1 then the
  content phases P4 (sun) and P5 (anomaly) before the architecture phases P2
  (component library) and P3 (spec editor). Reasons: the content bakers are
  self-contained extensions of the proven legacy-baker pattern and lowest risk
  to the props contract; the plan document's own build order runs the spectral
  sequence right after the taxonomy rename; and having the content bakers in
  hand informed the component-layer descriptors. Committed in the order
  P1, P4, P5, P2, P3, P7, P6.

- 2026-07-16: **G-class byte-stability by gating, not a hash test.** The sun
  per-pixel core can't run in the node/vitest env (no canvas), so a baked-canvas
  regression hash isn't runnable there. Instead every style-specific term is
  written so it is a strict no-op at G's parameters (granuleScale 14 ≡ the old
  literal; ambientWisp/spikes/ionizedShell 0 → skipped; giant/rim/white-dwarf
  branches gated on style; coolCap whiteMix = 1 for kelvin ≥ 5200, and G is
  5800). G byte-stability is therefore guaranteed structurally and confirmed
  visually.

- 2026-07-16: **Two coexisting systems, both kept.** The legacy single-recipe
  modes (flare/sun/galaxy/nebula/planet/anomaly) remain the fast path and the
  home of the fully art-directed hero bakers (e.g. the magnetar dipole cage,
  the black-hole hat). The new PCG-object mode is an *additional* mode that
  composes the §8 component layers into editable stacks. They share math
  (pcgMath, profiles, blackbody) but neither replaces the other, per the
  StellarObjectResearch2 §4.1 "don't replace the editor" boundary and the
  dispatch's explicit permission to keep legacy modes.

- 2026-07-16: **Black-hole bridge (task #13 / P6).** There are two black holes
  in the product and they serve different jobs:
  - The **positional** `src/render/blackHoleLayer.ts` is the *real* one: a
    screen-space GR lens that bends the actual starfield behind it, with a
    photon ring and Doppler-beamed disc, placed by direction on the sky. It is
    the tool whenever the BH must genuinely occlude and lens the background.
    Untouched by this work.
  - The **sprite** BH — the anomaly `black-hole` style (`bakeBlackHole`) and
    the `lens-art` component layer — is baked, self-contained decorative art:
    a shadow disc, photon ring, Doppler accretion disc, and an art-directed
    "hat" (far-side image bent over the top). A sprite has no knowledge of the
    sky behind it, so its "shadow" only reads against the light the sprite
    itself provides; it composites additively like every other baked flare.
    Use it for distant, decorative black holes where the disc is its own
    backdrop. The UI tooltip and this PRD say so; there are **no** `src/render`
    changes. This satisfies "the anomaly black-hole subtype IS the
    PCG-editable black hole sprite" while keeping true lensing positional.

- 2026-07-16: **smbh-torus rewrite during verification.** The first torus drew
  where |x| ≈ R_t (two vertical side-blobs) with a hard horizontal seam from a
  near/far source-over split. Rewritten to a single additive elliptical
  doughnut in tilted disc coords (r_disc = hypot(x, y/sinT) ≈ R_t) with a
  smooth tanh near-side brightening — now reads as an AGN dusty doughnut with
  the core peeking through the hole.

- 2026-07-16: **Determinism of component layers.** Each layer derives its
  noise/point stream from `object.seed XOR layer.seed XOR salt`, so adding or
  reordering a layer never reshuffles another layer's stars (§3.3 named-seed
  discipline). The `diffraction-spikes` param label was renamed "Style" →
  "Pattern" so it can't collide with the subtype "Style" select in the editor.

## Follow-ups (deliberately deferred)

- A `magnetosphere` component layer (dipole cage as a reusable §8 layer) so the
  magnetar can be expressed as a spec stack; today the cage lives only in the
  legacy anomaly baker.
- Component-layer presets for the remaining legacy anomaly styles
  (tde/nova/kilonova/smbh-torus) — the current preset catalog covers all 11
  layer types but not every legacy subtype as a stack.
- A canvas-capable test harness (jsdom + a 2D-context shim, or a headless
  Playwright hash step) to make baked-output regression hashes runnable in CI;
  today baked-output verification is visual (screenshots) and structural.
