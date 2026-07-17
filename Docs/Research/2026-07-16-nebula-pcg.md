# Procedural Compact Nebula Sprites — Research Findings

*2026-07-15. Scope: 2D nebula **sprites** (0.125 to 1.5 degrees apparent size,
quarter-moon to 3-moon) for a space skybox tool, not full-sky background
fields. Target renderer: per-pixel canvas loop, 3D Perlin FBM + domain
warping, radial gradients, additive/multiply compositing, deterministic RNG.
PCG only, no telescope-image compositing; real photos used for LOOK reference
only.*

---

> **2026-07-15 revision:** the standalone `pillars` generator style was
> removed. Pillars are a *tiny inner structure within* an emission nebula —
> the Pillars of Creation span ~4–5 ly inside the ~70×55 ly Eagle Nebula —
> so at this tool's sprite scale (¼–3 moons for a whole object) a lone
> pillar sprite reads wrong. Pillar morphology remains documented below as
> interior detail for a possible future high-zoom / inner-structure pass.

## 1. Morphology taxonomy (look references only)

| Type | Named references | Visual signatures to imitate |
|---|---|---|
| Emission star nursery | Orion Nebula (M42) core, Carina Nebula core | Bright compact core near ionizing OB stars, radial bright-to-dim falloff, fine wispy tendrils/shock-front filaments radiating outward, warm palette (Halpha red/pink dominant with green/teal HII highlights); Orion's "window-curtain" layered sheet structure ([ESA/Hubble](https://esahubble.org/images/opo9026a/)); embedded bright stars sit inside the brightest gas, not at edges |
| Pillars / elephant trunks | Eagle Nebula "Pillars of Creation" (M16), Cone Nebula | Elongated finger/column shapes tapering to a point away from the ionizing star cluster, bright rim on the side facing the illuminating star(s), darker silhouette/dust body on the trailing side, small bright knots (evaporating gaseous globules) at tips ([Wikipedia: Pillars of Creation](https://en.wikipedia.org/wiki/Pillars_of_Creation)); rim-brightening is photoionization plus reflection off the molecular-cloud surface facing the OB stars |
| Dark nebulae & globules | Barnard 68, Horsehead Nebula (B33), Coalsack | Barnard 68: compact, roundish, near-total silhouette with almost no internal detail, sharp-ish but slightly soft (diffusion-limited) edge against a starfield/bright background ([Wikipedia: Barnard 68](https://en.wikipedia.org/wiki/Barnard_68)); Horsehead: recognizable silhouette shape rising from a bright red background (IC 434), self-shadowed underside; Coalsack: large, low-contrast dust lane blocking Milky Way star density rather than glowing |
| Reflection nebulae | Pleiades wisps (Merope Nebula NGC 1435) | Soft blue haze concentrated tightly around individual bright stars, no sharp shell, wispy and filamentary, fading fast with distance from the star (blue preferentially scattered, dust not self-luminous) ([Space.com](https://www.space.com/stargazing/astrophotography/astrophotographer-captures-pleiades-seven-sisters-glowing-through-ghostly-blue-veil), [Backyard Astronomer](https://backyard-astronomer.com/blog/pleiades-seven-sisters-m45)) |
| Planetary nebula shells | Ring Nebula (M57), Helix Nebula (NGC 7293), Cats Eye (NGC 6543) | Central star plus one or more concentric/annular shells, often a brighter torus around the equator with fainter polar hourglass lobes (Ring is a doughnut/hotdog bipolar shape); Cats Eye shows 11+ nested concentric rings from pulsed ejection; Helix reads as two overlapping disks; OIII teal dominates inner shell, Halpha/NII red dominates outer rim ([MNRAS/arXiv Cats Eye modelling](https://arxiv.org/pdf/2209.01313)) |
| Supernova remnant filaments | Veil Nebula (Cygnus Loop), Crab Nebula (M1) | Thin, lacy, curved filament network, "crumpled bed-sheet" of thread-like bright arcs rather than solid blobs, low fill-factor (mostly empty/transparent between filaments), color mixes Halpha red / OIII teal / SII deep-red along different filament strands; Crab additionally has a diffuse blue-white synchrotron glow filling the interior between filaments ([Wikipedia: Veil Nebula](https://en.wikipedia.org/wiki/Veil_Nebula)) |

---

## 2. PCG recipes mapped to the available renderer

General pipeline for every type: density field, then shaping envelope, then
color LUT lookup, then edge/rim pass, then embedded stars, then composite.

### 2.1 Density field construction

- Base: 3-5 octave 3D FBM (sample a fixed z-slice or z = seed offset for 2D
  sprites), lacunarity around 2, gain/persistence around 0.5, per Space
  Engine's "Distorted fBm" approach (freq, octaves, distortion amount,
  lacunarity, H, offset all exposed as params) ([SpaceEngine Procedural Generation wiki](https://spaceengine.fandom.com/wiki/Procedural_Generation)).
- Domain warping: warp sample coordinates with a second (and optionally
  third) independently-seeded FBM field before the final density read:
  density = fbm(p + warpAmt * fbm3(p + offsets)). This is the single
  highest-value trick, it turns isotropic "cotton ball" Perlin into filament,
  billow, and shear structure ([iq: domain warping](https://iquilezles.org/articles/warp/)).
  Two chained warp levels ("warp of a warp") reads as noticeably more organic
  than one ([AltPsyche FBM and warping](https://altpsyche.dev/blog/sf-fbm-and-warping)).
- Ridged vs. plain FBM, pick per morphology:
  - Emission core / reflection wisp: plain FBM (soft, billowy).
  - Pillars: FBM warped strongly along one axis (elongation), not ridged.
  - SNR filaments: ridged multifractal, 1 minus abs(fbm) per octave then
    accumulate, produces thin bright "canyon ridge" lines instead of blobs,
    exactly the lacy filament look ([Musgrave ridged multifractal](https://docs.mariextensionpack.org/6R2v1/RidgedMultiNoise.html), [Neil Blevins: procedural noise](http://www.neilblevins.com/art_lessons/procedural_noise/procedural_noise.html)).
  - Dark globule/dust lane: low-octave FBM, mostly used as an alpha mask
    (inverted) rather than a color-driving density.

### 2.2 Shaping envelopes

- Radial falloff (star nurseries, reflection wisps): density times
  smoothstep(outerR, innerR, dist(p, center)), optionally raised to a power
  (pow(falloff, 1.5-3)) to punch up contrast and avoid a flat gradient disc.
- Anisotropic / directional falloff (pillars, jets): scale the radial term
  non-uniformly, stretch along a chosen axis, then apply a column mask:
  multiply by a warped "tube" SDF (distance to a bent centerline, width
  tapering toward the far end) so the pillar narrows to a point.
- Shell/ring envelope (planetary nebulae): density times gaussianRing(dist,
  shellRadius, shellWidth), one or two rings at different radii/widths for
  nested-shell looks (Cats Eye multi-ring), optionally squashed on one axis
  for the Ring Nebula's torus-seen-nearly-face-on look.
- Filament envelope (SNR): apply the ridged-noise result as the density
  directly (already thin), then multiply by a soft overall radial vignette so
  filaments fade out toward the sprite edge instead of hard-cutting.
- Silhouette envelope (dark nebula): near-binary mask from low-frequency FBM
  thresholded with a soft smoothstep, no bright color pass at all; the
  "color" is negative (subtracts from / occludes the background starfield via
  multiply-blend or alpha punch-through).

### 2.3 Color assignment (physical line to hue)

| Emission source | Wavelength | Hue | Where it appears |
|---|---|---|---|
| Halpha (hydrogen-alpha) | 656 nm | red / pink | Emission cores, pillar rims, SNR filaments; traces warm ionized hydrogen ([Astro Manual narrowband guide](https://theastromanual.com/narrowband-astrophotography-ha-oiii-sii/)) |
| OIII (doubly-ionized oxygen) | 501 nm | teal / cyan-blue | Hottest regions near massive stars, dominant in planetary-nebula inner shells, secondary color in SNR filaments |
| SII (ionized sulfur) | 672 nm | deep red | Shock fronts / outer edges, traces slower-moving excited gas at nebula boundaries, used at rim/edge not core ([Wonderdome: Hubble color processing](https://wonderdome.co.uk/hubble-colour-images-processing/)) |
| Reflection (scattered starlight) | broadband, blue-shifted | pale blue | Dust illuminated by nearby hot stars, concentrated near the star, not volume-filling ([Cosmos Darkroom Pleiades](https://cosmosdarkroom.com/blog/pleiades-m45-automated-processing-unveils-celestial-dust)) |
| Dust extinction | n/a | brown / black / desaturated | Multiply-blend silhouette layer, no additive contribution |

Implementation: drive a 1D gradient LUT by density (or by a second decorrelated
noise field for extra hue variance), with stops chosen from the table above per
morphology. For an SHO ("Hubble palette") look specifically: run three
correlated density fields (same seed, slightly different scale/warp offsets),
map to R=SII, G=Halpha, B=OIII channels independently before compositing; this
alone produces the recognizable Hubble-palette gold/teal contrast without any
extra structural work ([Wonderdome](https://wonderdome.co.uk/hubble-colour-images-processing/)).

### 2.4 Edge treatments

- Ionization rims (pillars, bright-rimmed globules): compute the gradient of
  the density field; where the gradient points toward the illuminating star
  position and density crosses a threshold, boost brightness/saturation, a
  cheap rim = pow(saturate(dot(normalize(grad), toStar)), k) term added on
  top of the base color. This single directional-rim term is what makes a
  blob read as lit from one side instead of flat ([arXiv: pillar photoionization structure](https://arxiv.org/pdf/1012.1500)).
- Dust hard edges: unlike gas (soft additive falloff), dust silhouettes
  should use a sharper smoothstep band (narrower transition width) and be
  composited with multiply/subtract instead of additive, since real dust
  edges (Horsehead, Coalsack) read as crisper-but-still-slightly-soft cutouts
  against bright backgrounds rather than gaussian-blurred glow.
- Filament edges (SNR): the ridged-noise construction already produces thin
  bright cores with soft falloff on both sides, no separate edge pass needed,
  but adding a thin brighter "core line" (threshold the top 10-15% of ridged
  value) sells the delicate-lacework look.

### 2.5 Embedded-star handling

- Place a small deterministic-RNG-seeded point cluster (2-8 stars) at/near the
  local density maximum of the field (nursery cores, pillar tips get one
  bright "tip star" cluster).
- Each embedded star gets a small local illumination halo: an additive radial
  gradient sprite centered on the star, radius scaled to a few percent of the
  nebula sprite, blended additively on top of the gas layer; this is what a
  reflection-nebula wisp structurally is (Pleiades: nebulosity is literally
  starlight scattered near the star, not volume-filling gas) ([Backyard Astronomer Pleiades](https://backyard-astronomer.com/blog/pleiades-seven-sisters-m45)).
- For pillars/rims, the illuminating star should sit outside the dense
  structure (at the position the rim brightening points toward), not inside
  it; direction of rim lighting must be consistent with where that star (or
  an off-sprite implied star direction) is placed.
- For planetary nebulae, exactly one central star at the sprite center is
  correct (progenitor white dwarf), no cluster.

---

## 3. Practical PCG/gamedev tricks against the "uniform fog" look

- Domain warp is the number-one fix for the flat/cotton-ball problem: raw
  FBM has isotropic frequency character in every direction; warping breaks
  that symmetry and introduces shear/filament structure for near-zero extra
  cost ([iq domain warping](https://iquilezles.org/articles/warp/)). This
  project's own prior finding in `docs/MODERN-LOOK-RESEARCH.md` section 2.A
  confirms the same conclusion for full-sky nebula layers; the technique
  transfers directly to sprites.
- Contrast shaping, not just density: apply a pow(density, 1.5-3) or an
  S-curve remap after FBM, before mapping to color/alpha. Raw FBM output is
  low-contrast/mid-gray-heavy; without a contrast pass everything reads as
  uniform haze regardless of noise quality.
- Combine noise types: mixing Perlin/FBM (soft billows) with ridged noise
  (hard structure) in the same field avoids the single-frequency-character
  tell; ridged multifractal specifically produces canyon/filament lines
  rather than blobs ([Musgrave ridged multi](https://docs.mariextensionpack.org/6R2v1/RidgedMultiNoise.html)).
- Layering order matters: build back-to-front, faint wide-radius diffuse
  glow first (additive, low alpha), mid-scale structural density second,
  then bright fine filament/rim highlights last, then embedded-star
  point-lights on top. Flattening this into one noise-to-color pass is what
  produces the dated "poster" look (also documented in this repo's
  `docs/MODERN-LOOK-RESEARCH.md` section 1, dated-signal row 1).
- Vary density field per octave role: do not reuse identical fbm() calls for
  shape and for color-variance; use a second, decorrelated noise sample to
  drive hue/palette-position independent of the alpha/density sample, so
  color patches do not line up 1:1 with brightness patches (real nebula
  images show color and brightness varying somewhat independently across
  ionization structure).
- Threshold and skip low-density texels: Space Engine explicitly skips
  emission where density falls below a cutoff rather than letting it fade to
  a flat dim haze; hard-zero regions read as "nebula has edges" rather than
  "nebula fills the whole sprite" ([SpaceEngine wiki](https://spaceengine.fandom.com/wiki/Procedural_Generation)).
- Anisotropy sells scale: real nebulae are never round blobs at this
  apparent-size range; pillars are elongated, filaments are thin curves,
  shells are rings not circles. Isotropic radial falloff alone is the
  fastest way to read as a generic PCG blob regardless of noise quality.

---

## 4. Priority: best recognizability-per-implementation-effort

1. Reflection wisp (Pleiades-style): cheapest option, radial-falloff FBM
   plus blue hue plus a star-centered illumination halo. No rim logic, no
   shell math, no directional lighting needed. High recognizability from
   color alone.
2. Emission star nursery (Orion/Carina-style): domain-warped FBM plus a
   Halpha/OIII multi-stop LUT plus radial falloff plus an embedded star
   cluster at the density peak. Reuses the same warp machinery as reflection
   wisps; the win is the SHO-style multi-channel color pass (section 2.3).
3. Dark globule/silhouette (Barnard 68-style): cheap, low-octave FBM
   threshold mask, multiply-composited, no color pass at all. Very high
   recognizability (strong, simple silhouette) for very low implementation
   cost, arguably the best effort/payoff ratio in the whole list.
4. Planetary nebula shell (Ring/Helix-style): moderate cost, same density
   machinery but shaped by a ring/gaussian-annulus envelope instead of
   radial falloff, single central star. Distinctive silhouette (donut/eye
   shape) makes it read correctly even with fairly crude noise.
5. Pillars/elephant trunks (Eagle-style): highest complexity of the top
   five, needs a column/tube SDF mask, a directional rim-lighting term keyed
   to an illuminating-star direction, and tip-star placement. Very
   recognizable when done, but requires the most new shaping logic
   (anisotropic mask plus gradient-dot rim pass) relative to the others.

SNR filament networks (Veil/Crab) are deliberately excluded from the top
five: they need ridged multifractal plus a low-fill-factor thin-line look
that is harder to keep readable at the 0.125 to 1.5 degree sprite scale
(filaments would be only a few pixels wide at the small end of that range);
worth adding later as a sixth style once the ridged-noise primitive exists
for other reasons.

---

## Sources

- [iq - Domain warping](https://iquilezles.org/articles/warp/)
- [AltPsyche - FBM and Domain Warping](https://altpsyche.dev/blog/sf-fbm-and-warping)
- [SpaceEngine Wiki - Procedural Generation](https://spaceengine.fandom.com/wiki/Procedural_Generation)
- [Neil Blevins - Procedural Patterns and Noise](http://www.neilblevins.com/art_lessons/procedural_noise/procedural_noise.html)
- [Mar Extension Pack - Ridged Multi Noise](https://docs.mariextensionpack.org/6R2v1/RidgedMultiNoise.html)
- [Wonderdome - How the colourful Hubble images are made](https://wonderdome.co.uk/hubble-colour-images-processing/)
- [The Astro Manual - Narrowband Astrophotography Guide](https://theastromanual.com/narrowband-astrophotography-ha-oiii-sii/)
- [Wikipedia - Pillars of Creation](https://en.wikipedia.org/wiki/Pillars_of_Creation)
- [arXiv - Effects of Magnetic Fields on Photoionised Pillars and Globules](https://arxiv.org/pdf/1012.1500)
- [Wikipedia - Barnard 68](https://en.wikipedia.org/wiki/Barnard_68)
- [ESA/Hubble - Window-curtain structure of the Orion Nebula](https://esahubble.org/images/opo9026a/)
- [Backyard Astronomer - Meet the Pleiades](https://backyard-astronomer.com/blog/pleiades-seven-sisters-m45)
- [Space.com - Astrophotographer captures Pleiades ghostly blue veil](https://www.space.com/stargazing/astrophotography/astrophotographer-captures-pleiades-seven-sisters-glowing-through-ghostly-blue-veil)
- [Cosmos Darkroom - Pleiades (M45) dust processing](https://cosmosdarkroom.com/blog/pleiades-m45-automated-processing-unveils-celestial-dust)
- [arXiv - Morphokinematic modelling of the Cats Eye Nebula](https://arxiv.org/pdf/2209.01313)
- [Wikipedia - Veil Nebula](https://en.wikipedia.org/wiki/Veil_Nebula)
- This repo - `docs/MODERN-LOOK-RESEARCH.md` (prior findings on domain warping and layering order, confirmed transferable to sprite scale)
