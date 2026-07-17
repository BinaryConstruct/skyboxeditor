# Layer-control parity vs original Spacescape 0.5.1

Source of truth: local original source at `D:\dev\ai\gamedev\spacescape-0.5.1\src`
(`SpacescapePlugin/src/SpacescapeLayer*.cpp` for the param maps,
`Spacescape/src/QtSpacescapeMainWindow.cpp` `mPropertyTitles` for the UI list).
Compared against our `src/core/io.ts` field tables and `src/ui/Inspector.tsx`.

## Original's complete user-facing layer options

**Common (all layers):** name, type (switchable dropdown), visible, seed,
sourceBlendFactor, destBlendFactor.

**Points:** numPoints, pointSize, nearColor, farColor, mask block
(maskEnabled, maskNoiseType, maskSeed, maskOctaves, maskGain, maskLacunarity,
maskOffset, maskPower, maskScale, maskThreshold).

**Billboards:** numBillboards, minSize, maxSize, texture, nearColor, farColor,
same mask block.

**Noise:** noiseType (fbm/ridged), octaves, gain, lacunarity, offset
(ridged only), scale, powerAmount, shelfAmount (UI: "Threshold"),
ditherAmount, innerColor, outerColor, previewTextureSize.

Non-features (checked because they look like features):
- `maskInnerColor` / `maskOuterColor` exist only in the Qt title map — no
  layer ever reads them. Dead entries in the original.
- `gpu` is read by the noise layer but never written or shown (write is
  commented out) — internal.
- `persistance` is a load-time alias, not a separate option.
- The noise layer has **no** mask in 0.5.1 (points/billboards only) — matches us.
- No HDR params in 0.5.1; our hdrPower/hdrMultiplier convention is our own
  extension (emitted only when set).

## Parity verdict

Every user-facing option in the original exists in our Inspector, almost
always with extras on top (warp, pointSizeMax, blackbody color mode,
galactic band, textureMix, huePalette, ramps, HYG catalog, plus six whole
new layer types). Two real gaps:

1. **Layer Type dropdown.** The original lets you switch an existing
   layer's type in place (points ↔ billboards ↔ noise), keeping
   name/visible/seed/blend. We only add-new + delete. Low value — type
   switching resets most params anyway since the types share little.
2. **`visible` is a saved per-layer param in the original's XML.** Ours is
   the eye toggle, but it lives in App state (`hidden` Set) and is not
   serialized — saving and reopening a project loses which layers were
   hidden, and importing a legacy XML with `<visible>false</visible>`
   ignores the flag. This is the gap worth fixing.

Minor difference, not a gap: the original used unbounded Qt spinboxes;
our sliders clamp to curated ranges (Script tab still accepts anything).
