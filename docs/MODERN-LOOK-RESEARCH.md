# Making Spacescape Skyboxes Look Modern — Research Findings

*2026-07-15. Context: spacescape-web bakes layers (FBM/ridged Perlin nebulas,
point stars, billboard flares) into cubemap RTTs and composites with per-layer
blend factors. Exports are plain textures for UE 5.8 / Godot 4. Everything
below is evaluated against that pipeline.*

---

## 1. Why the 2010 look reads as dated

The original Spacescape output has a recognizable "old procedural" signature.
Each cause pairs with a fix that appears in §2:

| Dated signal | Cause | Fix |
|---|---|---|
| Cotton-ball / smoke-blob nebulas | Raw FBM has uniform frequency character in every direction; isotropic Perlin octaves | Domain warping (§2.A), flow/curl noise (§2.E) |
| Flat, poster-like color | Two-color lerp (`mix(outer, inner, n)`) — one hue axis, no spectral variety | Multi-stop color ramps + astro palettes (§2.B) |
| No depth or lighting | Density mapped straight to color; no absorption, no light source, no parallax cue | Pseudo-volumetric raymarch (§2.C), embedded-star illumination (§2.H) |
| Uniform star salt | Single near/far color lerp, uniform sphere distribution, constant point size | Blackbody colors + magnitude distribution + galactic band (§2.F) |
| Additive-only glow soup | Everything brightens; no dark structure | Dust/extinction layers (§2.D) |
| LDR flatness in-engine | 8-bit bake caps highlights at 1.0, engine bloom has nothing to bite | HDR bake + EXR/HDR export (§2.G) |

The common thread: 2010 output encodes **one scalar field, one hue ramp, no
light transport**. Modern-looking skies fake all three cheaply.

---

## 2. Technique catalog

Ratings: **Difficulty** 1–5 for *this* codebase (fragment-shader cubemap bake
already exists), **Payoff** = expected visual improvement. "Fit" says where it
lands in the architecture. All techniques bake to plain textures, so the
UE/Godot export contract is unaffected.

### A. Domain warping — Difficulty 1–2 · Payoff ★★★★★ · Fit: modifier on noise layer

`fbm(p)` → `fbm(p + warpAmt * vec3(fbm(p+c1), fbm(p+c2), fbm(p+c3)))`, one or
two levels deep ([Quilez, *Domain warping*](https://iquilezles.org/articles/warp/)).
Kills the isotropic Perlin look instantly — filaments, billows, and shear
appear. wwwtyro/space-3d's whole nebula is exactly this: 6 octaves where each
octave *displaces the sampling position* with three permuted noise reads, then
a `pow(c, falloff)` shaping ([space-3d](https://github.com/wwwtyro/space-3d),
`nebula.glsl`). Implementation: add `noiseType: 'warped'` (or a `warpAmount` /
`warpOctaves` param pair on the existing noise layer) — ~15 lines in
`NOISE_FRAG`, two new uniforms, two new sliders. The pegwars nebula writeup
warns the effect degenerates into chaos when overdriven — default subtle
(warp ≈ 0.3–0.6 of feature scale) ([pegwars](http://pegwars.blogspot.com/2018/12/rendering-nebulae.html)).

### B. Multi-stop color ramps + astro palettes — Difficulty 1–2 · Payoff ★★★★★ · Fit: modifier on noise layer

Replace `mix(outerColor, innerColor, n)` with a 1D gradient LUT texture
(256×1, already have the plumbing — the grad LUT works the same way). Density
→ ramp position. This is what pegwars does with ramps *sampled from NASA
nebula photos*, and it's the single biggest color upgrade available.
Ship preset ramps:
- **Hubble/SHO palette**: SII→red, Hα→green, OIII→blue false-color mapping;
  in practice: teal-gold ramps with white-hot cores ([AstroBackyard narrowband primer](https://astrobackyard.com/narrowband-imaging/), [The Astro Manual](https://theastromanual.com/narrowband-astrophotography-ha-oiii-sii/)).
  A cheap trick for "JWST feel": run *three* correlated density fields (same
  seed, slightly different scale/warp) and assign each to a channel before
  ramping — spatially decorrelated hue like real emission-line structure.
- **Emission red/Hα**, **reflection blue**, **planetary teal** presets.
UI: gradient editor already planned in Phase 3 spec. Keep the 2-color path as
the legacy default so old saves render identically.

### C. Pseudo-volumetric raymarched nebula — Difficulty 3–4 · Payoff ★★★★★ · Fit: NEW layer type

The real generational leap. Per cubemap texel, march N steps (32–64 at bake
time is fine — it's not per-frame) along the view direction through a warped
FBM density field confined to a shell or SDF region; accumulate
emission and extinction with Beer–Lambert transmittance:

```
T = 1; C = 0;
for step: d = density(p); e = ramp(d);       // emissive color from ramp
  C += T * e * d * stepLen;                   // in-scatter/emission
  T *= exp(-absorption * d * stepLen);        // extinction
```

This produces self-shadowed, layered clouds with genuine depth cues — the
look EVE-style skyboxes get from offline Blender volume renders
([80.lv EVE-inspired workflow](https://80.lv/articles/creating-nebula-skyboxes-in-blender-hardware-setup-for-rendering) — "clouds are volumes with 3D procedural noise
controlling density; getting the noise to look good is 80% of the work").
References: [GM Shaders volumetric guide](https://mini.gmshaders.com/p/volumetric),
[Maxime Heckel's raymarched cloudscapes](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/),
[Toni Sagrista, rendering nebulae](https://tonisagrista.com/blog/2024/rendering-aurorae-nebulae/),
[Godot volumetric nebula shader](https://godotshaders.com/shader/volumetric-nebulae-clouds/).
Params: density scale, absorption, emission gain, shell inner/outer radius,
step count (quality), warp amount, ramp. Deterministic (seeded noise, fixed
steps) — golden-testable. Slow preview at 1024+ → keep preview res at 256 and
only bake high-res on export (pipeline already distinguishes these).

### D. Dust lanes / extinction — Difficulty 2 · Payoff ★★★★ · Fit: new layer preset + one new blend idiom

Real nebulas read "3D" largely because *dark* dust occludes *bright* gas. The
compositor already supports the needed math — a layer with
`src=zero, dst=one_minus_src_colour` *subtracts scaled color*, and
`src=zero, dst=src_colour`... wait — `dest_colour` source factor gives
multiplicative darkening. Concretely: bake a high-lacunarity **ridged, warped**
noise into a layer and composite `src=zero, dst=one_minus_src_colour`
(dst × (1−srcColor)): dark filaments carve through everything below. Ship it
as a "Dust lanes" preset of the nebula layer (inner=extinction strength,
outer=black). Optional rim-glow: second copy, slightly offset seed, additive
at low gain — edges of dust catch light. Zero new shader code beyond warping;
it's a *recipe*, so also a preset-gallery item.

### E. Curl / flow noise — Difficulty 2–3 · Payoff ★★★ (static) ★★★★ (animated) · Fit: modifier + animation roadmap

Curl of a noise potential gives divergence-free, fluid-looking vector fields
([Bridson, SIGGRAPH 2007](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf);
[fast shader variants](https://atyuwen.github.io/posts/bitangent-noise/)).
For static bakes it's a fancier warp (streaky, swirling filaments — good for
"turbulent" region presets). Its real value arrives with the Phase 5 dynamic
skies: advecting the warp offset along a curl field over time gives convincing
slow nebula drift that doesn't "swim" the way naive time-lerped noise does.

### F. Star field realism — Difficulty 2 · Payoff ★★★★ · Fit: upgrade to points layer

Three independent, cheap upgrades to `generatePoints`:
1. **Blackbody color**: sample stellar temperature (e.g. 2500–15000 K, skewed
   heavily toward cool/red per real populations), convert Kelvin→RGB with a
   shader-grade approximation ([zubetto/BlackBodyRadiation HLSL](https://github.com/zubetto/BlackBodyRadiation),
   [Houdini blackbody reference](https://www.sidefx.com/docs/houdini/vex/functions/blackbody.html)).
   Kills the "uniform white/blue salt" look; K–M dwarfs give warm specks.
2. **Magnitude distribution**: real star counts grow ~geometrically per
   magnitude step; sample brightness from an exponential distribution and map
   to point alpha (and size for the top fraction of a percent). A handful of
   bright stars + thousands of faint ones reads "sky"; equal-brightness salt
   reads "screensaver".
3. **Galactic band**: multiply acceptance probability by
   `exp(-(latitude/σ)²)` against a randomly oriented great circle —
   a Milky-Way density band. Pairs beautifully with a matching faint warped
   nebula layer along the same plane. (Trivially deterministic; one extra
   rejection test in the existing masked-placement loop.)

### G. HDR bake + bright-star glow — Difficulty 2–3 · Payoff ★★★★ · Fit: pipeline + new positional layer

Switch the layer RTTs and compositor target to `HalfFloatType` and let values
exceed 1.0 (bright star cores 10–100×, nebula cores 2–4×). Export EXR (three
`EXRExporter`) / RGBE `.hdr` — UE imports long-lat `.hdr` natively and its
bloom/eye-adaptation then does the heavy lifting; same for Godot glow. This is
why modern engine skies "feel" alive with zero extra authoring — the *range*
is the feature. The 0.5.x `hdrPower`/`hdrMultiplier` params (already modeled
as optionals) were the original author reaching for exactly this.
Companion layer: **bright star / sun glow** rendered directly into the sky
(space-3d style: `exp(-(angularDist - size) * falloff)` around a direction,
color + intensity >1) with optional 4- or 6-point diffraction spikes
(anisotropic falloff along two rotated axes, subtle). This is the planned v2
"Sun" layer; it doubles as the light source for §2.H.

### H. Embedded-star illumination of nebulas — Difficulty 3–4 · Payoff ★★★★ · Fit: cross-layer modifier on §C

During the §C raymarch, add `L * exp(-τ(p→star))`-ish local brightening for
1–4 "illuminator" directions (taken from Sun layers or hand-placed): density
near an illuminator gains its tint; density behind thick regions falls into
shadow. Even a crude version (brighten by `1/(1+d²)` in angular distance,
modulated by local density) creates the "star-forming region" look of Hubble
imagery — pegwars lists exactly this ("suns within nebulae illuminate the
volume from within") as the step that lifted their renders. God-ray streaks
can be faked at bake time with a short radial blur pass from each illuminator
— it's a cubemap-space post pass, still exports as plain texture.

### I. Exotic depth layer (Star Nest / kaliset) — Difficulty 2 · Payoff ★★★ · Fit: NEW layer type (optional)

[Kali's "Star Nest"](https://www.shadertoy.com/view/XlfGRj) (65 lines, MIT-friendly ports exist incl. [Godot](https://godotshaders.com/shader/star-nest-2/))
iterates `p = abs(p)/dot(p,p) - c` and accumulates magnitude deltas — an
instant dense "deep field" of layered star sheets with parallax-like nesting.
As a low-gain background layer it adds the "there's *more* behind the sky"
feeling the flat 2010 bakes lack. Cheap, seedable, wild parameter space —
good "surprise me" material, worth gating behind sane presets.

### J. Bake-time finishing pass — Difficulty 2 · Payoff ★★ · Fit: post pass (use sparingly)

Fine mono grain (replaces the original's crude dither), very subtle
large-scale luminance variation (breaks up "even exposure everywhere"), and
optional gentle saturation curve. Do **not** bake tone mapping or vignettes —
engines own that; keep the export linear/HDR.

---

## 3. What prior art actually does (quick reference)

- **space-3d** ([repo](https://github.com/wwwtyro/space-3d), [live](https://tools.wwwtyro.net/space-3d/index.html)): per-octave displacement-warped
  FBM, `pow` falloff, `vec4(color, density)` normal-blended nebula sheets;
  stars as exponential angular-falloff glows; seeded; bakes to cubemap.
  Its nebulas still hold up because of warping + falloff shaping alone.
- **pegwars** ([blog](http://pegwars.blogspot.com/2018/12/rendering-nebulae.html)): raymarched FBM density, per-step warp,
  photo-sampled 1D gradient LUTs, planned in-volume sun illumination.
- **EVE-style pipeline** ([80.lv](https://80.lv/articles/creating-nebula-skyboxes-in-blender-hardware-setup-for-rendering)): offline volume renders (Blender), noise-driven
  density, art-directed lighting — the look §C+§H approximates at bake time.
- **Star Nest** ([Shadertoy XlfGRj](https://www.shadertoy.com/view/XlfGRj)): kaliset fractal accumulation; unmatched
  density-per-instruction for deep starfields.
- **Astro palettes**: Hubble SHO mapping and narrowband structure
  ([AstroBackyard](https://astrobackyard.com/narrowband-imaging/), [The Astro Manual](https://theastromanual.com/narrowband-astrophotography-ha-oiii-sii/)) — the palette DNA of every "wow" nebula image
  of the last 20 years, JWST included.

---

## 4. Recommended shortlist (priority order)

1. **Domain-warped noise option (§A)** — ~20 lines of GLSL, two sliders, and
   every existing preset can be "remastered" by flipping one param. Do first;
   everything else builds on the warped field.
2. **Gradient ramps + astro palette presets (§B)** — replaces the two-color
   lerp with a 256×1 LUT (existing DataTexture plumbing), gradient editor in
   the already-planned inspector; ship SHO/Hα/reflection presets. With #1
   this alone erases most of the 2010 signature.
3. **HDR bake + EXR/HDR export (§G)** — flip RTTs to half-float, keep byte
   path for legacy parity, add intensity/hdrMultiplier param (the legacy
   0.5.x params slot straight in). Payoff compounds in-engine via bloom.
   Add the sun/bright-star glow layer here (it wants >1.0 values).
4. **Raymarched volumetric nebula layer (§C)** — the new flagship layer type.
   Start with 32 steps, warped FBM density in a shell, emission ramp +
   Beer–Lambert absorption; add 1–2 illuminator directions (§H) as v2.
   Bake-time cost only; deterministic; exports unchanged.
5. **Star field physics (§F) + dust lanes recipe (§D)** — blackbody colors,
   exponential magnitudes, galactic band in `generatePoints`; dust as a
   preset using existing blend factors + warped ridged noise. Both small,
   both high-visibility.

Sequencing note: #1–#3 are additive params on existing types (legacy saves
stay pixel-identical when new params are at defaults). #4 introduces the
first post-2010 layer type and should land after the Phase 3 inspector so its
params get proper controls. #5 rides along anywhere.

---

## 5. Sources

- Inigo Quilez — [Domain warping](https://iquilezles.org/articles/warp/), [fBM](https://iquilezles.org/articles/fbm/)
- [wwwtyro/space-3d](https://github.com/wwwtyro/space-3d) · [live tool](https://tools.wwwtyro.net/space-3d/index.html) · [C++ port](https://github.com/matusnovak/space-3d)
- [pegwars — Rendering Nebulae](http://pegwars.blogspot.com/2018/12/rendering-nebulae.html)
- [Toni Sagrista — Rendering volume aurorae and nebulae](https://tonisagrista.com/blog/2024/rendering-aurorae-nebulae/)
- [GM Shaders (Xor) — Volumetric Raymarching](https://mini.gmshaders.com/p/volumetric) · [Maxime Heckel — Volumetric cloudscapes](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/)
- [Bridson — Curl-Noise for Procedural Fluid Flow (SIGGRAPH 2007)](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf) · [Fast divergence-free noise](https://atyuwen.github.io/posts/bitangent-noise/)
- [Kali — Star Nest (Shadertoy)](https://www.shadertoy.com/view/XlfGRj) · [Godot port](https://godotshaders.com/shader/star-nest-2/)
- [AstroBackyard — Narrowband imaging primer](https://astrobackyard.com/narrowband-imaging/) · [The Astro Manual — Ha/OIII/SII](https://theastromanual.com/narrowband-astrophotography-ha-oiii-sii/) · [astroimagery — Hubble palette mapping](https://astroimagery.com/techniques/post-processing/hubble-palette-colours/)
- [zubetto/BlackBodyRadiation (HLSL)](https://github.com/zubetto/BlackBodyRadiation) · [Houdini blackbody](https://www.sidefx.com/docs/houdini/vex/functions/blackbody.html)
- [80.lv — EVE-inspired nebula skyboxes in Blender](https://80.lv/articles/creating-nebula-skyboxes-in-blender-hardware-setup-for-rendering)
- [Godot Shaders — Volumetric nebulae](https://godotshaders.com/shader/volumetric-nebulae-clouds/)
