# Reference-Sample Catalog & New-Generator PCG Research

*2026-07-15. Scope: the ten reference images the user dropped into
`samples/`, cataloged object-by-object, mapped to concrete 2D PCG recipes
feasible in this tool's renderer (canvas 2D per-pixel loop, CPU Perlin FBM +
domain warp, seeded MSVC LCG, additive/multiply compositing; 384–1024 px
sprite bakes, target <1 s per 512 px bake). Companion to
`docs/NEBULA-PCG-RESEARCH.md` (nebula sprite morphology + recipes — not
repeated here) and `docs/MODERN-LOOK-RESEARCH.md`.*

*Correction to the drop notes: the file named "…100 breathtaking
planetary…" is a collage of planetary **nebulae** and supernova-remnant
bubbles, not planets. The samples contain almost no planet-surface
reference (one small Jupiter tile in the Chandra grid), so planet-surface
work is ranked low here.*

---

## 1. Sample-by-sample catalog

| # | File | What it shows | Photographic / artistic | Visual signatures worth stealing |
|---|---|---|---|---|
| S1 | `eagle-nebula-10000-telescope.jpg` | Eagle Nebula (M16) wide field, narrowband SHO "Hubble palette" | Photographic (amateur narrowband) | Rust-gold Ha/SII cloud banks filling the whole frame; teal-cyan OIII cavity at center; near-black dust silhouettes with crisp brown rims layered *in front of* glowing gas; the Pillars of Creation are a tiny (~2 % of frame) interior detail — confirms the repo's earlier call that pillars are not standalone sprites; star field is hundreds of small warm-orange points (narrowband kills blue star color), no diffraction spikes; nebulosity is multi-scale — huge soft banks + mid billows + fine tendrils, never one noise frequency |
| S2 | `25th.jpg` | Chandra 25th-anniversary grid: 25 X-ray + optical/IR composites (Cas A, Tycho, Crab, SN 1987A, pillars in X-ray, Centaurus A jet, galaxy clusters, star-cluster fields, spirals with hot halos, Jupiter) | Photographic (multiwavelength false-color composites) | Signature magenta/violet diffuse plasma glow layered over orange/blue optical detail; galaxy-cluster gas reads as a smooth structureless violet blob with small galaxies embedded; SNRs read as lacy shells; star clusters read as dense point swarms with a few spiked bright members |
| S3 | `a-stunning-collage-…planetary…webp` | ~50 planetary nebulae + SNR bubbles (Ring, Cat's Eye, Hourglass MyCn18, butterfly bipolars, Helix, translucent SNR bubbles like SNR 0509-67.5, Crab) | Artistic collage assembled from real HST/Chandra photos, saturation boosted | Limb-brightened annular shells; complementary two-tone pairs (teal core / orange rim, green shell / magenta edge); nested concentric shells; bipolar hourglass lobes pinched at the waist; *translucent* bubbles — thin-shell limb brightening with a faint see-through interior; scattered 4-point diffraction-spike stars between objects |
| S4 | `78952016007-…webp` | Deep field with a nearby dwarf galaxy resolved into thousands of individual blue stars (bottom-right swarm + compact blue knot) over a background of field galaxies of every type | Photographic (JWST/HST) | Background galaxies span 2–40 px: tilted spirals, edge-on needles, orange dusty smudges, tiny gold ellipticals — dozens per frame, random position angles; the resolved-star swarm has a strong density gradient toward its core and is monochromatically blue; galaxies outnumber stars in parts of the frame |
| S5 | `30_Largest_Infrared_Galaxies_with_Labels.jpg` | 2MASS near-IR atlas: 30 labeled big galaxies — spirals (M31, M81, M83, M101, NGC 6946, M63…), edge-ons (NGC 253, NGC 891, NGC 5907, NGC 55, NGC 4631, M104 Sombrero, NGC 3628), ellipticals (M110, Maffei 1), starburst M82, irregulars (IC 10, NGC 300), Cen A | Photographic (2MASS survey mosaics) | The full Hubble-sequence morphology zoo in one grid; IR palette: dominant white-gold bulges, faint blue-purple arms, grainy noise floor; edge-ons are thin gold needles with a central bulge bump and (in optical counterparts) a dark midplane lane; ellipticals are perfectly smooth gold ovals with zero internal structure; IC 10 is a loose asymmetric speckle patch |
| S6 | `interesting-galaxies-in-webbs-first-deep-field…webp` | 25 labeled crops from Webb's First Deep Field (SMACS 0723): dusty orange spirals, flocculent white spiral, edge-ons ("Torpedo", "Streak"), interacting/merging pairs ("Slug", "Giant Collider", "WTF 1"), gravitationally lensed arcs ("Quadruple Lensed"), diffuse elliptical pair ("Owl's Eyes"), clumpy irregulars ("Volcano") | Photographic (JWST NIRCam) | JWST palette: dust reads *orange/red*, not brown; cores white-gold; ellipticals have big soft halos; lensed galaxies are curved arcs/streaks; mergers show bridges, tails, and double cores; foreground stars carry the 6+2 JWST spike pattern; background peppered with tiny red dots (high-z galaxies) |
| S7 | `HJ8-BFDWQAA-QEJ.jpg` | ~15×15 grid of ~220 galaxies sorted left→right from blue star-forming spirals/irregulars to gold ellipticals/lenticulars/edge-on S0s (survey atlas sorted by color/type) | Photographic (survey atlas mosaic) | Demonstrates galaxy color **bimodality** (blue cloud vs red sequence): blue galaxies show clumpy knotted arms (star-forming regions as bright grains); red ones are utterly smooth with steep central concentration; roughly a third of the population is red/smooth — a believable sky needs both populations, and *smooth* ellipticals need no noise at all |
| S8 | `649178585_…jpg` | Numbered cutout atlas #1–105 of distant disk galaxies from a deep survey | Photographic (HST/JWST survey cutouts) | What galaxies look like at sprite-relevant sizes (30–150 px): soft-edged ovals, two-tone bulge+disk (warm core, cooler rim), muted saturation, low contrast, visible noise grain, occasional orange dusty disk or spiked foreground star; hardly any show crisp arm structure at this scale |
| S9 | `649181535_…jpg` | Same atlas, #106–263 | Photographic | Same signatures as S8; together they are the definitive size/color/contrast reference for a "background galaxy sprinkle" generator |
| S10 | `images.jpg` | Small web-res collage of ~54 misc HST-era thumbnails: Rosette, Crescent, Helix, Horsehead, Orion, Cas A, Crab, Sombrero, Whirlpool, Andromeda, star clusters, a comet, V838 Mon light echo, hourglass PN | Artistic grid of photographic thumbnails | Breadth checklist rather than detail reference: confirms the object-type menu a skybox tool should cover — emission/dark/planetary nebulae, SNRs, spirals, edge-ons, interacting pairs, star clusters |

**Cross-sample observations**

- Galaxies, not nebulae, are the dominant subject of this drop (7 of 10
  samples). The tool currently has exactly one galaxy morphology (tilted
  spiral particle cloud) plus a monochrome 2.2:1 soft-ellipse smudge flare
  (`proc:galaxy-smudge` in `src/render/proceduralFlares.ts`).
- Color bimodality (S7) is the single cheapest realism rule: pick each
  galaxy from one of two palettes — blue-white clumpy or smooth warm-gold —
  instead of interpolating one hue range
  ([galaxy color–magnitude diagram](https://en.wikipedia.org/wiki/Galaxy_color%E2%80%93magnitude_diagram)).
- Ellipticals and distant smudges need *less* PCG, not more: no noise, no
  arms — an analytic profile with the right falloff (§2.1) plus soft grain.
- The JWST "modern look" (S4, S6, S8, S9) is mostly *population* realism:
  many small varied background galaxies at random position angles, orange
  dust palette, 6+2 spikes on the few foreground stars.

---

## 2. Per-category PCG recipes

All recipes assume the existing machinery: `PerlinNoise.fbm`, chained
domain warp, `MsvcRng`, `kelvinToRgb`, per-pixel `ImageData` loops, additive
particle splats. Every recipe below is O(pixels) or O(particles) and fits
well under 1 s at 512 px.

### 2.1 Elliptical / lenticular galaxy (S5, S6, S7)

The workhorse is the **Sérsic profile**
([Wikipedia](https://en.wikipedia.org/wiki/S%C3%A9rsic_profile)):

```
I(r) = I0 · exp( -b_n · ((r/Re)^(1/n) - 1) ),   b_n ≈ 2n - 1/3
```

- `n = 4` (de Vaucouleurs) for ellipticals — very peaky core, enormous soft
  halo; `n = 1` is an exponential disk. Expose `sersicN` (0.8..5).
- Elliptical coordinates: `r = hypot(x', y'/q)` after rotating by position
  angle; axis ratio `q` 0.45..0.95 (E0..E6).
- **No structural noise.** S7's red-sequence tiles are featureless. Add
  only: (a) ±3 % very-low-frequency FBM asymmetry so it isn't perfectly
  analytic, (b) faint star-speckle grain (tiny additive points, alpha
  ~0.03) in the halo mimicking resolved-giants graininess (S5).
- Color: single warm palette, `kelvin` ~4200–5200 (gold/cream), slight
  bluing toward the edge (mix 10 % toward white at large r). Old stars,
  no blue.
- Lenticular (S0): sum two Sérsic components — `n≈4` bulge + `n≈1` disk
  with smaller q — same color family; optionally a *thin* dust ring at
  fixed `r/Re` (see 2.2 lane math).
- Cost: pure per-pixel formula, no noise octaves — milliseconds. Galaxy
  profile fitting tools evaluate exactly these models in bulk on GPU
  ([Galmoss](https://arxiv.org/pdf/2404.07780)); one sprite is trivial.
- Prior art: [Gaia Sky's procedural galaxy generation](https://gaiasky.space/news/2025/galaxy-generation/)
  builds ellipticals as the low-dust/big-bulge corner of the same
  parameter space as spirals — worth mirroring: implement as parameters on
  a unified galaxy generator rather than a separate code path if
  convenient.

### 2.2 Edge-on disk with dust lane (S5, S6, S7)

The iconic needle (NGC 891, NGC 5907, Sombrero). In sprite space
(`R = |x|`, `z = y`):

```
I_disk(R,z) = I0 · exp(-R/hR) · sech²(z/z0)
τ_dust(R,z) = τ0 · exp(-R/hR) · exp(-|z - z_off| / (0.5·z0))
I = I_disk · exp(-τ) + I_bulge(Sérsic n≈2, small Re)
```

- `sech²` vertical profile with dust scale height ≈ 0.5× stellar scale
  height is the standard fit for edge-on disks
  ([S4G edge-on scale heights](https://iopscience.iop.org/article/10.3847/1538-4357/ad85d5),
  [disk galaxy properties, Barnes ch. 4](https://home.ifa.hawaii.edu/users/barnes/ast626_05/pdg.pdf)).
- `z_off` (±0.2·z0) shifts the lane off the midline — sells a
  slightly-off-edge-on viewing angle (Sombrero look when combined with a
  large bulge).
- Break the lane's uniformity: modulate `τ0` along R with 2-octave FBM
  (clumpy dust, S5's NGC 891) and warp `z_off(R)` with a gentle low-freq
  sine for the classic integral-sign **warp** (optional `warpAmount`).
- Radial truncation: multiply by `smoothstep(Rmax, 0.85·Rmax, R)` — real
  disks truncate rather than fading forever
  ([MNRAS disc truncation](https://academic.oup.com/mnras/article/334/3/646/1426215)).
- Color: warm bulge (4500 K), cooler disk tips (7000–9000 K), lane darkens
  *and* reddens (multiply RGB by (1, 0.75, 0.55)·exp(-τ) style attenuation)
  — dust lanes look brown-red, not gray.
- Params: `hR`, `z0`, `bulgeSize`, `dust` (τ0), `laneOffset`, `warpAmount`,
  `kelvin` pair. Per-pixel formula + one FBM field → well under 1 s.

### 2.3 Irregular / clumpy dwarf galaxy (S5 IC 10, S6 "Volcano", S4 swarm)

- Accept/reject particle scatter: propose points in the unit disc, accept
  with probability `fbm(p·2) > threshold` (low-freq noise defines an
  asymmetric envelope), splat soft points — reuses the spiral generator's
  particle splat loop minus the spiral math.
- Add 3–8 **star-forming knots**: bright blue-white Gaussian clumps
  (radius 3–8 px) at accepted noise maxima, plus 1–3 pink Ha dots
  (HII regions) adjacent to the brightest knots — the knotted-grain look is
  what separates S7's blue population from smooth red ones.
- Offset the luminosity centroid from the envelope centroid (RNG ±15 %):
  asymmetry is the type signature.
- Palette: blue-white (9000–12000 K) body, knots near-white, sparse warm
  foreground speckle.

### 2.4 Interacting / merging pair with tidal tails (S6, S2, S10)

Two believable tiers:

1. **Cheap kinematic fake:** bake two spiral particle clouds at offset
   centers; displace each particle by a "bridge + tail" vector field —
   pull particles on the companion side along a quadratic Bézier toward the
   companion, fling the far side outward along the reversed arc. Reads as a
   merger at smudge scale.
2. **Real restricted three-body (recommended — it is genuinely cheap and
   deterministic):** Toomre & Toomre's 1972 method — each galaxy is a disc
   of *massless* test particles on circular orbits around a point mass; the
   two point masses fly by on a parabolic/hyperbolic orbit; integrate all
   particles in the combined two-point-mass potential. This "produces
   realistic and visually appealing results with only a few thousand
   particles and can run in under one second"
   ([JSPAM, a restricted three-body code](https://arxiv.org/pdf/1511.05041),
   [parabolic restricted three-body tails & bridges](https://doi.org/10.1093/mnras/stx1990),
   [Galaxy Zoo: Mergers models](https://arxiv.org/pdf/1604.00435)).
   - ~1500 particles/galaxy × ~300 leapfrog steps ≈ 1 M force evals of a
     two-term 1/r² sum — a few ms in JS. Fully deterministic from the seed
     (initial orbital phases) + encounter params.
   - Params: `massRatio` (0.2..1), `periDistance`, `discTiltA/B`,
     `phase` (how far past closest approach — early = bridge-dominated,
     late = long tails), `particles`.
   - Render with the existing additive splat + bulge gradients; color the
     tails slightly bluer than the cores (tidally triggered star
     formation).

### 2.5 Deep-field background galaxy sprinkle (S4, S6, S8, S9)

Not one sprite — a *population* bake. The existing `proc:galaxy-smudge`
flare + rotation/aspect jitter is the right delivery mechanism but has a
single monochrome shape. Upgrade path:

- Bake a small **atlas of typed mini-galaxies** (e.g. 8–16 variants at
  64–96 px) from the other generators run at low LOD: disky smudge
  (Sérsic n=1 oval + brighter core), elliptical (n=4), edge-on needle,
  clumpy blue irregular. Sprinkle layer picks per-instance variant, PA,
  aspect, size, tint from the seed.
- Population rules (straight from S7/S8/S9):
  - Size: power-law — many 3–10 px, few 20–60 px (`count(>s) ∝ s^-1.5`).
  - Color: bimodal draw — ~55 % blue-cloud (clumpy, 8000–11000 K tint,
    higher alpha knots), ~35 % red-sequence (smooth, 4200–5200 K),
    ~10 % orange "dusty JWST" (S6/S8 palette: orange disk, white core).
  - Contrast: *low*. S8/S9 cutouts are soft, muted, noise-grained; bake at
    alpha 0.3–0.7, never full-brightness.
  - A few per hundred get a faint tidal distortion (stretch one end) —
    matches real deep fields and reads as depth.
- Optional garnish at very low count: **lensed arcs** (S6) — thin
  circular-arc streaks (stroke an arc of a large circle with soft ends,
  10–30° of sweep) placed around a bright elliptical; instantly reads
  "JWST deep field".
- Prior art for sprinkle-style skybox composition:
  [wwwtyro's 2D space-scene procgen writeup](https://wwwtyro.net/2016/10/22/2D-space-scene-procgen.html)
  and [wwwtyro/space-3d](https://github.com/wwwtyro/space-3d) (seeded
  cubemap bake: point stars → bright stars → nebulae layers; galaxies are
  the missing layer this tool can add on top of that lineage).

### 2.6 Globular cluster (S2, S10; generic skybox need)

- Radial star density from the **Plummer model** — closed-form inverse
  CDF makes seeded sampling trivial
  ([Wikipedia: Plummer model](https://en.wikipedia.org/wiki/Plummer_model)):

  ```
  r = a / sqrt(u^(-2/3) - 1),  u = rng.unit()   // then random angle
  ```

  Clamp/resample at a tidal cutoff `rt ≈ 8–15·a` — a **King profile**'s
  key improvement over Plummer is exactly that finite tidal radius
  ([King 1962 lecture notes](https://astro.mff.cuni.cz/vyuka/AST021/2020-2021/Dinnbier-2.pdf),
  [MNRAS globular-cluster outer profiles](https://academic.oup.com/mnras/article/419/1/14/998277)).
- Two-component render: (a) unresolved core — small additive Gaussian
  glow (the center is too dense to resolve; S2's cluster tiles read as a
  glow with speckle), (b) 800–3000 resolved point stars, size 0.7–1.6 px,
  from the Plummer draw.
- Color: old population — cream/gold (4300–5500 K) with ~1–2 % blue
  stragglers/HB stars (8000–10000 K) for salt-and-pepper; keep saturation
  low.
- Params: `coreRadius a`, `tidalRatio`, `stars`, `coreGlow`, `kelvin`,
  `blueFraction`. Pure particle scatter — fast.
- The same sampler with `a` large, `stars` 30–80, sizes 2–5 px and a
  0–30 % blue reflection-wisp underlay (already exists as `wisp`) gives an
  **open cluster** (Pleiades) nearly for free.

### 2.7 Planetary-nebula & bubble extensions (S3; extends existing `shell`)

S3 justifies three parameter-level upgrades to the existing `shell` style
rather than a new generator:

- `shellCount` (1..3): sum 2–3 gaussian-ring envelopes at staggered radii
  (Cat's Eye nested shells; recipe already in NEBULA-PCG-RESEARCH §2.2).
- `bipolarity` (0..1): multiply the ring envelope by
  `1 + bipolarity·(cos(2·(θ-θ0)) )`-style lobing, plus a waist pinch
  (suppress density in a band through the center perpendicular to the
  axis) → butterfly/hourglass lobes at high values.
- `bubble` sub-mode — the translucent SNR look (S3's wine-glass bubbles):
  thin-shell **limb brightening** is just path length through a spherical
  shell; per pixel with `x = r/R`:

  ```
  I(x) = sqrt(max(0, 1 - x²·k)) path through outer sphere
       - inner-sphere term  →  in practice: I ∝ 1/sqrt(1 - x²) clamped,
         peaking hard at x→1, faint but nonzero interior
  ```

  Tint rim and interior from the existing colorA/colorB pair
  (magenta rim / faint red fill = SNR 0509). Add 5–10 % low-freq FBM
  wobble to shell radius so the circle isn't perfect.

### 2.8 Galaxy-cluster / X-ray plasma glow (S2)

Cheap "Chandra composite" hero object: the intracluster medium is a
smooth hot-gas halo ([intracluster medium](https://en.wikipedia.org/wiki/Intracluster_medium));
its surface brightness is classically fit by a **beta model**:

```
I(r) = I0 · (1 + (r/rc)²)^(-3β + 1/2),   β ≈ 2/3
```

- Render: violet/magenta additive glow from that profile (elliptical q
  0.7–1), ±5 % low-freq FBM lumpiness, then scatter 10–30 mini-ellipticals
  (§2.1 at low LOD, gold, 3–12 px) inside — instantly reads as S2's
  cluster tiles. Optionally one lensed arc (§2.5).
- Doubles as a general "X-ray palette" accent layer over any other
  generator (magenta halo over a spiral = S2's galaxy tiles).

### 2.9 Diffraction-spike & foreground-star polish (S2, S3, S4, S6)

Already largely present (`proc:hubble` 4-spike, `proc:jwst` 6+2 in
`src/render/proceduralFlares.ts`). Sample-justified refinements:

- Physical pattern check: JWST = six primary spikes at 60° from the
  hexagonal segmented pupil **plus two fainter horizontal strut spikes**;
  four strut spikes hide inside the hex spikes by design
  ([Wikipedia: diffraction spike](https://en.wikipedia.org/wiki/Diffraction_spike),
  [Big Think: Webb's spikes](https://bigthink.com/starts-with-a-bang/james-webb-spikes/)).
  The current `proc:jwst` matches; expose it in the flare *generator*
  (`FlareGenParams`) as a `pattern: 'even' | 'hst' | 'jwst'` enum so baked
  flares (not just billboard presets) can carry it.
- Spike texture: real spikes are not smooth wedges — modulate alpha along
  the spike with `sin²`-spaced nodes (interference orders) and a slight
  chromatic spread (red fringe outward, blue inward) at ~10 % strength.
  S6's foreground stars show both.
- Narrowband star tint (S1): a `starTint` kelvin/salmon override for
  starfield layers so SHO-palette scenes get uniformly warm small stars.

### 2.10 Planet variety (weakly justified — only S2's Jupiter tile)

Deprioritized: the drop contains no planet-surface reference. When it
comes up: craters for rocky bodies = stamped bowls (dark floor ring +
bright rim arc on the sun side) with power-law radii, or inverted Worley
F1 ([Worley/cellular basis, via survey of planet-texture tooling](https://www.texturesforplanets.com/));
gas giants = the existing `banding` plus per-band domain-warped turbulence
and 1–3 storm ovals (ellipse splat + local swirl warp), per the common
layered-noise gas-giant recipe
([Screaming Brain gaseous planet textures](https://screamingbrainstudios.com/planet-textures-gaseous/)).

---

## 3. Prioritized new-generator recommendations

Ranked by (recognizability gain) / (implementation cost), with the samples
that justify each. "Cost" assumes reuse of existing FBM/RNG/splat
machinery.

| Rank | Generator | Justifying samples | Cost | Notes |
|---|---|---|---|---|
| 1 | **Elliptical/S0 galaxy** (Sérsic n, axis ratio, PA; §2.1) | S5, S6, S7 (a third of S7's population) | Very low — analytic per-pixel, no noise | Biggest coverage gap: the sky currently has zero smooth red-sequence objects; also feeds ranks 3 and 6 as a low-LOD component |
| 2 | **Edge-on disk with dust lane** (§2.2) | S5 (7 of 30 tiles are edge-ons), S6, S7 | Low — per-pixel formula + 1 FBM field | The most iconic single galaxy silhouette (Sombrero/NGC 891); current spiral generator's tilt squash cannot produce a midplane lane |
| 3 | **Background galaxy sprinkle v2** — typed mini-galaxy atlas + bimodal color population (§2.5) | S4, S8, S9, S6 | Medium — mostly plumbing (atlas bake + per-instance variant pick); reuses ranks 1–2 at low LOD | Highest whole-sky "modern JWST look" payoff; upgrades the existing single-shape `proc:galaxy-smudge` |
| 4 | **Interacting pair with tidal tails** — restricted three-body (§2.4) | S6 ("Slug", "Giant Collider"), S2, S10 | Medium — small leapfrog integrator + existing splats; <1 s for ~3 k particles ([JSPAM](https://arxiv.org/pdf/1511.05041)) | Hero object; nothing else in the tool produces bridges/tails, and fakes read as fakes at hero scale |
| 5 | **Globular cluster** — Plummer/King particle ball (§2.6) | S2, S10 | Low — inverse-CDF sampler + existing point splats | Also yields open clusters as a parameter corner; fills the "dense point swarm" object class every sample grid contains |
| 6 | Clumpy irregular dwarf (§2.3) | S5 (IC 10), S6, S4 | Low | Completes the Hubble-sequence zoo; shares splat loop with rank 5 |
| 7 | Planetary-nebula shell params: `shellCount`, `bipolarity`, `bubble` limb-brightening (§2.7) | S3 (dozens of bipolars/nested/bubbles) | Low — envelope math only, extends existing `shell` | Parameter upgrade, not a new generator |
| 8 | Galaxy-cluster ICM glow (beta-model violet halo + embedded mini-ellipticals + optional lensed arc; §2.8) | S2, S6 | Low once rank 1 exists | Distinctive "multiwavelength composite" hero look |
| 9 | Flare/spike polish: `pattern` enum in FlareGenParams, spike nodes + chromatic fringe, narrowband star tint (§2.9) | S6, S4, S3, S1 | Very low | Billboard presets exist; this ports them to baked flare sprites |
| 10 | Planet surface variety (craters, storm ovals; §2.10) | (essentially none — S2 Jupiter tile only) | Low–medium | Defer until planet references actually arrive |

**Explicitly *not* recommended from these samples:**

- A standalone pillars generator — S1 re-confirms the removal decision:
  pillars are ~2 % of the parent nebula's extent.
- Photograph compositing — S3/S10 are collages; the tool's PCG-only stance
  stands, samples are look references.
- Lensed-arc *generator* as a first-class object — worth 20 lines inside
  the sprinkle/cluster generators, not its own UI surface.

---

## Sources

- [Wikipedia — Sérsic profile](https://en.wikipedia.org/wiki/S%C3%A9rsic_profile)
- [Gaia Sky — Procedural galaxy generation preview](https://gaiasky.space/news/2025/galaxy-generation/)
- [Galmoss — GPU-accelerated galaxy profile fitting (arXiv:2404.07780)](https://arxiv.org/pdf/2404.07780)
- [dexyfex — Galaxy rendering revisited](https://dexyfex.com/2016/09/09/galaxy-rendering-revisited/)
- [S4G — Stellar disk vertical scale heights of edge-on galaxies](https://iopscience.iop.org/article/10.3847/1538-4357/ad85d5)
- [Barnes — Properties of disk galaxies (course notes)](https://home.ifa.hawaii.edu/users/barnes/ast626_05/pdg.pdf)
- [MNRAS — Flattening and truncation of stellar discs in edge-on spirals](https://academic.oup.com/mnras/article/334/3/646/1426215)
- [JSPAM — restricted three-body code for interacting galaxies (arXiv:1511.05041)](https://arxiv.org/pdf/1511.05041)
- [MNRAS — Tails and bridges in the parabolic restricted three-body problem](https://doi.org/10.1093/mnras/stx1990)
- [Galaxy Zoo: Mergers — dynamical models of interacting galaxies (arXiv:1604.00435)](https://arxiv.org/pdf/1604.00435)
- [Wikipedia — Plummer model](https://en.wikipedia.org/wiki/Plummer_model)
- [King models lecture notes (Dinnbier, Charles University)](https://astro.mff.cuni.cz/vyuka/AST021/2020-2021/Dinnbier-2.pdf)
- [MNRAS — Outer density profiles of 19 Galactic globular clusters](https://academic.oup.com/mnras/article/419/1/14/998277)
- [Wikipedia — Galaxy color–magnitude diagram (red sequence / blue cloud)](https://en.wikipedia.org/wiki/Galaxy_color%E2%80%93magnitude_diagram)
- [Wikipedia — Diffraction spike](https://en.wikipedia.org/wiki/Diffraction_spike)
- [Big Think — Where do James Webb's unique spikes come from?](https://bigthink.com/starts-with-a-bang/james-webb-spikes/)
- [Wikipedia — Intracluster medium](https://en.wikipedia.org/wiki/Intracluster_medium)
- [wwwtyro — Procedural generation of 2D space scenes in WebGL](https://wwwtyro.net/2016/10/22/2D-space-scene-procgen.html)
- [wwwtyro/space-3d — seeded WebGL space skybox generator](https://github.com/wwwtyro/space-3d)
- [beltoforion — Rendering a galaxy with density wave theory](https://beltoforion.de/en/spiral_galaxy_renderer/)
- [Textures for Planets — planet texture tooling survey](https://www.texturesforplanets.com/)
- [Screaming Brain Studios — gaseous planet textures](https://screamingbrainstudios.com/planet-textures-gaseous/)
- This repo — `docs/NEBULA-PCG-RESEARCH.md`, `docs/MODERN-LOOK-RESEARCH.md`,
  `src/gen/generators.ts`, `src/gen/nebulaGen.ts`, `src/core/galaxy.ts`,
  `src/render/proceduralFlares.ts`
