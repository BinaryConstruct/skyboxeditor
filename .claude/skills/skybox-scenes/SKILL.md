---
name: skybox-scenes
description: Author or edit BinaryConstruct Skybox scene JSON — layer types, field semantics, seeds, and blend factors — validated against the published schema. Use when generating or modifying skybox scenes (.json / the app's Script tab / project.json inside .zip project bundles).
---

# Authoring BinaryConstruct Skybox scenes

A scene is one JSON document: `{"version": 2, "layers": [...]}`. Layers
composite **in array order** — index 0 is the farthest background, later
layers draw over earlier ones. The app's **Script** tab edits this document
live with line-precise errors; the same JSON is `project.json` inside the
`.zip` project bundles the Save button produces (legacy `.sspj` = same zip).

**Schema (source of truth):**
<https://skyboxeditor.com/schema/scene.v2.schema.json>
(in-repo: `public/schema/scene.v2.schema.json`; regenerate with
`npx vitest run src/core/schema.test.ts -u` after changing `src/core/io.ts`).

Every field is optional except `type` — omitted fields take the defaults
recorded in the schema (`default` on each property). Prefer omitting fields
you don't need; the app re-serializes canonically.

## Layer types

| type | what it renders |
|---|---|
| `noise` | nebula: seeded Perlin FBM/ridged cubemap, color ramp inner→outer |
| `volumetric` | raymarched emission + absorption nebula shell |
| `points` | star field (deterministic; blackbody or two-color) |
| `billboards` | textured flare quads; `textureMix` weights multiple textures |
| `galaxy` | hero spiral particle cloud (bulge, arms, dust, HII nebulae) |
| `sun` / `planet` | positional baked body on a quad (lon/lat placement) |
| `sprite` | any baked/uploaded texture on a placeable quad |
| `blackhole` | gravitational lens (geodesic LUT) + accretion disc |

## Semantics that matter

- **Determinism**: `seed` (int) fully determines a layer's randomness. Change
  the seed to re-roll; keep it to preserve a look exactly.
- **Blend factors** (`sourceBlendFactor` / `destBlendFactor`, Ogre-style):
  additive glow = `one`/`one`; occluding solid bodies = `one`/
  `one_minus_src_alpha`; darkening dust = `dest_colour`/`zero` (multiply —
  keep the layer's colors near-white and darken via the texture) or
  `zero`/`one_minus_src_alpha` (alpha-darken).
- **Placement** (sun/planet/sprite/blackhole/galaxy): `dirLonDeg` (−180..180),
  `dirLatDeg` (−90..90), `apparentSize` (angular size; sun/planet ≤1),
  `rotationDeg`; `locked: true` prevents viewport dragging.
- **Visibility**: `visible: false` hides a layer (the eye toggle) and
  excludes it from exports; omitted means visible — the app only ever
  writes the `false` state.
- **Additive layers ignore alpha** — brightness must come from RGB and
  `hdrMultiplier`, not the alpha channel.
- **HDR**: `hdrPower`/`hdrMultiplier` shape export brightness beyond 1.0 for
  `.hdr`/`.exr` targets.

## Workflow for generating a scene

1. Start from a dark base: one or two `noise` layers (low `offset`, subtle
   `outerColor`), then a masked brighter nebula for structure.
2. Add depth with 2–3 `points` layers: many small dim stars, fewer large
   bright ones (`numPoints`, `pointSize`/`pointSizeMax`), optionally a
   galactic band.
3. Accent with `billboards` (flare textures, `textureMix` for variety) and at
   most one or two hero objects (`galaxy`, `sun`, `blackhole`) — restraint
   reads better than density.
4. Validate: paste into the Script tab (red border + line/field errors), or
   check against the schema. Unknown layer `type` values are rejected;
   unknown fields are ignored (forward-compatible).

## Minimal example

```json
{
  "version": 2,
  "layers": [
    { "type": "noise", "name": "Base veil", "seed": 7,
      "innerColor": { "r": 0.09, "g": 0.05, "b": 0.16, "a": 1 },
      "outerColor": { "r": 0, "g": 0, "b": 0.02, "a": 1 } },
    { "type": "points", "name": "Far stars", "seed": 3, "numPoints": 12000 },
    { "type": "blackhole", "name": "Lens", "dirLonDeg": -35, "dirLatDeg": 8,
      "apparentSize": 0.09, "lensStrength": 0.8, "discAmount": 0.7,
      "discKelvin": 5200 }
  ]
}
```
