# Stellar-Object Styles — Unified "Style" Taxonomy & Implementation Plan

*2026-07-16. Scope: expanding the Stars-tab PCG workbench with (1) a unified
"Style" selector across every generator mode, (2) a full stellar-style zoo for
the sun generator (spectral classes, dwarfs, giants), (3) star-composition
styles (circumstellar dust ring, protoplanetary "solar system" disc), and
(4) a NEW `anomaly` generator mode for extreme objects (black holes, TDEs,
novae/supernovae/kilonovae, quasars, magnetars, pulsars, multiples).
Target renderer: canvas-2D per-pixel loops + primitive splats at
`GEN_SIZE = 384` (bakes up to 1024), deterministic per seed (`MsvcRng` /
`PerlinNoise`), <1 s per bake. Companion to `docs/NEBULA-PCG-RESEARCH.md` and
`docs/PCG-SAMPLES-RESEARCH.md`; existing machinery inventory in §1.*

---

## 1. Existing machinery to build on (inventory)

| Helper | Where | Reused by (below) |
|---|---|---|
| `kelvinToRgb(K)` blackbody tint (valid ~1000–40000 K) | `src/core/blackbody.ts` | every style's color anchor |
| Eddington limb darkening `I(mu) = 1 − u·(1 − mu)`, `mu = sqrt(1 − r²)` | `bakeSunGen`, `src/gen/generators.ts` | all stellar discs |
| Corona angular-noise streamers (`fbm` on the unit circle → per-angle reach, `exp(−(r−1)/reach)`) | `bakeSunGen` | G/K corona, pulsar wind haze, SN rays |
| Prominence recipe (noise-gated arcs × limb-hugging gaussian shell) | `bakeSunGen` | M-dwarf flare loops, magnetar loop glow |
| `sersicIntensity(r, Re, n)` | `src/gen/profiles.ts` | quasar host halo, SMBH bulge, nova/SN afterglow |
| `plummerRadius(u, a)` inverse-CDF sampler | `src/gen/profiles.ts` | SN ejecta particle scatter, TDE debris fan |
| `sech2(x)` disk vertical profile | `src/gen/profiles.ts` | dusty torus, edge-on protoplanetary lane |
| `gaussianCore / spike / ring` primitives | `src/render/proceduralFlares.ts` | dwarf cores, diffraction spikes, nova shells |
| `drawRingSet` (tilted ellipse bands, near/far occlusion split, seeded band noise) | `bakePlanetGen`, `src/gen/generators.ts` | dust ring, protoplanetary disc, dusty torus |
| Domain-warped FBM + ridged dust + hue decorrelation | `src/gen/nebulaGen.ts` | SN filaments, ambient wisp underlay, ejecta |
| Restricted 3-body leapfrog | `src/gen/galaxyMorph.ts` | (pattern only) TDE stream is analytic, not integrated |
| Real GR lens + photon ring + Doppler disc (positional layer) | `src/render/blackHoleLayer.ts` | the *sprite* BH copies its disc shading math; lensing itself stays positional (§6.1 caveat) |
| Sprite contract: opaque-black background, alpha folded into RGB (`flattenOntoBlack`) | `src/gen/genCommon.ts` | every new baker |

**One hard constraint that shapes several recipes:** baked sprites are almost
always composited **additively** (flare layers, one/one). An additive sprite
can only *add* light — it can never darken the sky behind it. Every "dark"
element below (BH shadow, dust lane, torus silhouette) therefore only reads
against light *the sprite itself provides*, or must be baked in `dark` mode
for a multiply layer. This is flagged per-style where it matters.

---

## 1b. Relationship to `docs/StellarObjects.md` (user draft)

The draft field guide + Three.js blueprint covers the same object families
this plan implements (O/B/G/M sequence, red supergiants, white dwarf /
neutron star / pulsar / magnetar, detached & contact binaries, stellar-mass
BH & SMBH, quasars, supernova/kilonova). Its *descriptive* signatures are
folded into the per-style recipes below (e.g. "few giant boiling cells" →
§4.3 two-scale mottle; "plasma bridge river between vampire stars" → §6.3
metaball contact neck; "strobe-fan polar beams" → §6.10 beams; "expanding
starquake rings" → §6.9 loop-top hotspots). Its *technical* recipes target
a live animated Three.js scene, not this tool's static sprite bakes, so
they map as follows:

| Draft blueprint idea | This plan |
|---|---|
| `uTime`-animated FBM plasma shaders on spheres | static per-pixel FBM granulation (§3) — one frozen moment; animation is out of scope (§9) |
| Vertex-displaced turbulent supergiant sphere | limb-radius wobble `r·(1 + 0.08·fbm(θ))` (§4.3) — same idea, 2D silhouette |
| Fresnel corona glow shell | existing corona/halo terms in `bakeSunGen` |
| Pulsar cones + spinning parent group | static hollow-cone beams + spin-axis hint (§6.10) |
| GSAP starquake ring tweens | static hotspots/loop glow (§6.9); time-based tweens excluded (§9) |
| CatmullRom tube plasma bridge with scrolling texture | metaball bridge field (§6.3) |
| Keplerian per-particle disk swirl | azimuth-stretched streak noise on the disc (§6.1 step 3) |
| Raymarched Schwarzschild lensing full-screen shader | already exists as the positional `blackHoleLayer`; explicitly NOT redone per-sprite (§9) |
| Particle-lifetime jet emitters (InstancedMesh) | analytic beam + knot profiles (§6 shared primitives) |
| Expanding SN particle cloud over frames | one-moment shell + ejecta with `shellAge`/`phase` params (§6.4–6.6) |

---

## 2. The unified "Style" taxonomy

Rename every per-mode variant selector to **Style** (UI label) and converge
the code on a `style` field per params interface:

| Mode | Today | After |
|---|---|---|
| star (flare) | no variant (params only) | `style`: `classic` \| `hst-spikes` \| `jwst-spikes` (ports the `proc:` billboard patterns into `FlareGenParams`, per PCG-SAMPLES-RESEARCH §2.9) |
| sun | no variant | `style`: 7 spectral classes + 6 structural + 2 composition (§3–§5) |
| galaxy | `morphology` select labeled "Morphology" | same field, UI label **Style** (keep `morphology` as the serialized key for .sspj compat; add `style` alias if convenient) |
| nebula | `style` select (already right) | unchanged: `nursery` \| `dark-dust` \| `wisp` \| `shell` |
| planet | no variant | `style`: `rocky` \| `gas-giant` (binds the existing `banding` param; optional later `ice`, `lava`) |
| anomaly (NEW) | — | `style`: 10 extreme-object styles (§6) |

Pattern to follow: `NEBULA_STYLE_DEFAULTS` — a
`Record<Style, Partial<Params>>` the UI applies on style change, so styles
are *presets + a few structural branches*, not ten parallel code paths.

---

## 3. Sun styles I: the O B A F G K M spectral sequence

These seven are **pure presets** over `SunGenParams` plus three small new
params — the cheapest win in the whole plan. Color anchors from the MK
sequence ([Wikipedia: stellar classification](https://en.wikipedia.org/wiki/Stellar_classification)):
O blue (>30000 K), B blue-white (10000–30000), A white (7500–10000),
F yellow-white (6000–7500), G yellow (5200–6000), K orange (3700–5200),
M red (2400–3700).

**New params on `SunGenParams`:**

- `granuleScale` (4..40, default 14): spatial frequency of the granulation
  FBM (`noise.fbm(dx·granuleScale, …)`). Today hardcoded 14. Giants need ~3
  (few huge cells), dwarfs ~24 (fine cells).
- `ambientWisp` (0..1, default 0): a faint domain-warped FBM haze across the
  whole sprite, tinted `kelvinToRgb(kelvin)`, alpha `0.10·ambientWisp·fbm`,
  windowed by the existing edge falloff. This is the "wispy surrounding
  nebulosity tinted by the star" from the user's O–M reference strip; it is
  three lines reusing the nebula wisp math at 2 octaves.
- `spikes` (0..8, default 0): optional diffraction spikes via the existing
  `spike()` primitive on top of the finished disc (white dwarf and O-class
  read better with 4).

**Per-class preset table** (values are defaults the Style select applies;
all remain user-tunable):

| Style | kelvin | granulation × scale | corona / extent | prominences | glow | ambientWisp | notes |
|---|---|---|---|---|---|---|---|
| O | 40000 | 0.05 × 20 | 0.35 / 0.9 | 0 | 0.85 | 0.5 | hot radiative envelope: essentially featureless disc, huge blue halo. O/B stars lack convective envelopes, so kill granulation and solar-type streamers; the "corona" is a smooth radiatively-driven wind haze — set corona low and rely on `glow` + wisp |
| B | 16000 | 0.08 × 20 | 0.4 / 1.0 | 0 | 0.75 | 0.35 | electric blue-white; faint smooth halo |
| A | 8500 | 0.15 × 18 | 0.45 / 1.1 | 0.05 | 0.6 | 0.2 | white; near-featureless |
| F | 6800 | 0.25 × 16 | 0.55 / 1.2 | 0.2 | 0.55 | 0.1 | yellow-white transition |
| G | 5800 | 0.35 × 14 | 0.7 / 1.4 | 0.4 | 0.5 | 0 | the existing `DEFAULT_SUN` — keep byte-identical output for old presets |
| K | 4400 | 0.45 × 12 | 0.6 / 1.2 | 0.55 | 0.45 | 0 | orange, spottier |
| M | 3100 | 0.6 × 10 | 0.45 / 0.9 | 0.85 | 0.4 | 0 | deep red-orange; M dwarfs are flare stars — prominences (magnetic loops) dominate over streamers |

Rendering math is unchanged from `bakeSunGen`; the sequence is legible
almost entirely through `kelvinToRgb` + the corona/prominence balance. Two
small physics touches worth adding while in there:

- **Limb-darkening coefficient by temperature:** hotter photospheres darken
  less. `u = clamp(0.9 − kelvin/50000, 0.25, 0.9)` as the *default* the
  style applies (still slider-overridable).
- **White-mix cap for cool stars:** the existing `whiteMix = 0.55·mu`
  washes M-class discs toward white; scale it by
  `min(1, kelvin/6000)` so cool discs stay saturated.

---

## 4. Sun styles II: dwarfs, giants, and the pulsar alias

Structural branches inside `bakeSunGen` (each is a preset **plus** one or
two new code paths):

### 4.1 `white-dwarf`

Signatures: tiny, intense, blue-white, compact halo — luminosity from
concentration, not extent.

- `discRadius` 0.05 (extend slider min from 0.08 to 0.03), `kelvin` 18000,
  `limbDarkening` 0.15, `granulation` 0, `prominences` 0, `corona` 0.
- Replace streamers with a hard compact glow:
  `I_halo(r) = glow · exp(−((r − 1)/0.35)^1.6)` (tight exponent, short
  scale) plus a broad faint skirt `0.12·glow·exp(−(r−1)/1.8)` so it still
  bleeds a little.
- 4 diffraction spikes at default 45°, length ~4 disc radii — the "intense
  point" tell at sprite scale.
- Optional `ionizedShell` (0..1): a faint teal `gaussianRing` at r ≈ 2.5–3
  disc radii (young WD still lighting its ejected planetary shell) — reuses
  the nebula `shell` envelope at low alpha.

### 4.2 `red-dwarf` / `brown-dwarf`

- **Red dwarf:** M-class preset at `discRadius` 0.09, `kelvin` 3000,
  `prominences` 0.9 with the prominence shell width doubled (loops are
  proportionally huge on small stars), `glow` 0.3.
- **Brown dwarf:** `kelvin` 1600 — but `kelvinToRgb` bottoms out at deep
  orange-red, while real T-dwarfs read **magenta/violet** (sodium D
  absorption removes the middle of the visible band —
  [Brown Dwarfs are Violet, RNAAS](https://iopscience.iop.org/article/10.3847/2515-5172/ac225c),
  [Wikipedia: brown dwarf](https://en.wikipedia.org/wiki/Brown_dwarf)).
  Add a per-style body-color override:
  `body = mix(kelvinToRgb(1600), {r:0.55, g:0.12, b:0.55}, magentaMix)`,
  `magentaMix` default 0.35.
- Brown dwarf structure: it is a *failed star* — reuse the **planet**
  banding math on the disc (`bands = 0.5 + 0.5·sin(dy·7 + fbm·4)`,
  amplitude 0.25) instead of granulation; `corona` 0, `glow` 0.15,
  near-black terminator not needed (self-luminous, keep flat shading).

### 4.3 `red-giant` / `red-supergiant`

Signatures (user reference + Betelgeuse literature): mottled deep-red
surface from a **handful of giant convection cells** — not fine grain —
plus an enormous soft halo from the dusty wind
([Freytag RHD simulations of Betelgeuse](https://www.aanda.org/articles/aa/full_html/2010/07/aa13907-09/aa13907-09.html),
[arXiv:1003.1407](https://arxiv.org/abs/1003.1407)).

- `discRadius` 0.24 (big), `kelvin` 3400, `limbDarkening` 0.85 (cool giants
  darken hard — sells sphericity).
- **Giant-cell mottling:** two-scale granulation replacing the single FBM:

  ```
  cells  = fbm(dx·2.6 + s1, dy·2.6, 3 oct)      // 4–8 blobs across the disc
  fine   = fbm(dx·9 + s2,  dy·9,  3 oct)        // secondary granulation
  b *= 1 + 0.38·granulation·cells + 0.10·granulation·fine
  ```

  and push color with the same field: hot cell tops toward
  `kelvinToRgb(3900)`, dark lanes toward `kelvinToRgb(2800)` —
  `col = mix(cool, hot, 0.5 + 0.5·cells)`. This two-tone mottle is the
  style's identity.
- **Halo:** `glow` 0.8 with the halo exponent relaxed to
  `exp(−((r−1)/3.2)^1.1)` — reaching most of the sprite. No streamer
  corona (`corona` 0.1 max): giants have slow dusty winds, not structured
  K-coronae.
- `red-supergiant` = same path, `discRadius` 0.28, `cells` scale 2.0,
  ±8 % low-freq radius wobble on the limb
  (`r_eff = r·(1 + 0.08·fbm(θ))` — the star is not round; use the nebula
  edge-noise trick on the disc boundary).

### 4.4 `blue-giant`

Signatures: electric blue disc, **bright thin rim**, long smooth halo.

- `kelvin` 22000, `discRadius` 0.2, `granulation` 0.05, `prominences` 0.
- **Rim brightening** (the reference's glowing edge — an artistic
  scattering shell, opposite of limb darkening): add
  `I_rim = 0.5·exp(−((r − 0.97)/0.05)²)` inside/at the limb, colored
  `mix(body, white, 0.6)`. Implement as a style-gated term next to the
  limb-darkening line (net profile: mild darkening toward 0.9, then the
  rim spike).
- Smooth halo `glow` 0.7 with a slight blue over-tint
  (`cb += 0.15·halo`), corona 0.25/extent 1.6 with the streamer contrast
  softened (`streak = 0.6 + 0.4·lobes` → `0.75 + 0.25·lobes`).

### 4.5 `pulsar` (alias)

The user's sun list includes pulsar; the full recipe lives in the anomaly
mode (§6.10). Implement **one** baker (`bakePulsar` in `anomalyGen.ts`) and
have the sun mode's `pulsar` style entry dispatch to it — same pattern as
`bakeGalaxyGen` dispatching to `galaxyMorph.ts`. No duplicate math.

---

## 5. Sun styles III: composition styles (star + disc systems)

### 5.1 `dust-ring` — distant debris/planetary ring around a small star

Signatures: a small star (any spectral preset) with a **far-out, thin,
tilted annulus** of dust — Fomalhaut-like eye.

- Bake the star via the normal path at `discRadius` ~0.06–0.1.
- Reuse **`drawRingSet`** verbatim with new ranges: `inner` 4..10 and
  `outer` 4.5..12 star radii (extend the param ranges; the planet version
  stops at 3.5), `opacity` 0.1..0.4, `tiltDeg` 15..75, dusty palette
  `{0.75, 0.62, 0.5}`.
- Two ring-specific touches:
  - **Forward-scattering asymmetry:** dust scatters forward, so the near
    side (bottom half after the tilt) is brighter — multiply band alpha by
    `1 + 0.5·sin(azimuth)` (same trick as the BH disc Doppler term in
    `DISC_FRAG`).
  - **Inner clearing glow:** a faint `ring()` at ~0.6× the ring inner
    radius, alpha 0.05 — zodiacal-light hint bridging star and ring.
- Params: `ringInner`, `ringOuter`, `ringTilt`, `ringOpacity`, `ringKelvin`
  (tint = `kelvinToRgb(ringKelvin)·0.5 + dust brown·0.5` so hot stars light
  their dust bluer).

### 5.2 `solar-system` — protoplanetary / planetary disc (HL Tau look)

Signatures: star + broad tilted disc crossed by **concentric dark gaps**
(HL Tau's ALMA image: major gaps near 13, 32, 63 AU —
[AAS Nova](https://aasnova.org/2016/12/19/selections-from-2016-gaps-in-hl-taus-protoplanetary-disk/),
[ApJL gas gaps](https://iopscience.iop.org/article/10.3847/2041-8205/820/2/L25));
planets at most **tiny points**, sitting inside gaps.

Per-pixel recipe (new function, ~80 lines):

1. **Disc-plane coordinates.** Rotate pixel by position angle `pa`, then
   un-tilt: `xd = x'`, `yd = y'/cos(tilt)` (clamp `cos` ≥ 0.15),
   `rd = hypot(xd, yd)`, `az = atan2(yd, xd)`.
2. **Base surface brightness** — power law with tapered edge, the standard
   disc parameterization:

   ```
   Σ(rd) = (rd/r_in)^(−γ) · exp(−(rd/r_c)^2) ,  rd > r_in
   γ = 0.6 (default), r_in = 1.6 R★, r_c = 0.42·spriteHalf
   ```

   plus `smoothstep(r_in, 1.3·r_in, rd)` so the inner hole is soft.
3. **Gap series** — geometric spacing reads as HL Tau (its major gaps are
   near a ×2.4 ratio; a ratio ~1.5–1.7 with 4–6 gaps looks right at sprite
   scale):

   ```
   r_k = r0 · g^k ,   k = 0..gapCount−1,  g = gapRatio (1.35..1.9, default 1.55)
   w_k = gapWidth · r_k                    (0.04..0.12, default 0.07)
   T(rd) = Π_k [ 1 − depth_k · exp(−((rd − r_k)/w_k)²) ]
   depth_k = 0.55..0.95 seeded per gap
   I = Σ(rd) · T(rd)
   ```

4. **Azimuthal texture:** multiply by
   `1 + 0.15·fbm(az·3, rd·6)` (faint spiral-ish clumps; keep subtle) and by
   the forward-scatter term `1 + scatter·sin(az_screen)` (near side
   brighter, `scatter` ~0.35).
5. **Midplane dust lane (tilted views):** for `tilt` > ~55°, attenuate a
   band around the screen-space midline:
   `atten = exp(−τ0·sech2(y_screen/(0.05·spriteHalf))·sin(tilt))`, reusing
   `sech2`, and redden what survives (× (1, 0.72, 0.5) at full bite) —
   the edge-on dust-lane math from `bakeEdgeOnGalaxy` at smaller scale.
6. **Color:** inner disc warm `kelvinToRgb(3800)`, outer cold
   `mix(kelvinToRgb(2600), {0.45,0.5,0.62}, 0.5)` (cold dust goes
   blue-gray); LUT position `t = clamp(rd/r_c)`.
7. **Planets:** for 0..3 seeded gaps, place a point at
   `(r_k·cos(az_p), r_k·sin(az_p)·cos(tilt))`, radius 1–2 px, tint
   `kelvinToRgb(4500..9000)`, alpha 0.9, tiny 2-px glow. Never larger —
   at this scale a planet is a pixel.
8. Star on top: standard small disc + glow (spectral preset), drawn last
   additively.

Params: `tilt` (0..70), `paDeg`, `gapCount` (0..6), `gapRatio`, `gapWidth`,
`discBrightness`, `scatter`, `planets` (0..3), `discKelvin`.
All O(pixels) — comfortably <1 s.

---

## 6. NEW mode: `anomaly` (src/gen/anomalyGen.ts)

`AnomalyGenParams { seed, style, ... }` +
`ANOMALY_STYLE_DEFAULTS` preset record, dispatched like
`bakeGalaxyGen`. Ten styles.

Shared new primitives (put in `anomalyGen.ts` or a small `beams.ts`):

- **Elongated gaussian beam** (the workhorse for pulsar/quasar/jets). In
  beam-local coords (ℓ along axis from origin, d perpendicular):

  ```
  w(ℓ)  = w0 + wSlope·ℓ                       // opening angle
  I(ℓ,d) = A · exp(−(d/w(ℓ))²) · exp(−ℓ/L)    // gaussian cross-section, exp length falloff
  ```

  Hollow-cone variant (pulsar radio beams are cones brightest at the rim —
  [Revisiting the Shape of Pulsar Beams](https://arxiv.org/pdf/astro-ph/9904336)):
  multiply by `0.55 + 0.45·(d/w(ℓ))²` before the gaussian, which
  double-peaks the cross-section.
- **Knot series along a jet:** brightness `× (1 + Σ_j A_j·exp(−((ℓ − ℓ_j)/s_j)²))`
  with geometric spacing `ℓ_j = L·q^(j−N)` (q ≈ 1.6, 3–5 knots, seeded
  amplitudes 0.5–1.5) — mimics M87's knot chain
  ([two-zone synchrotron knots, MNRAS](https://academic.oup.com/mnrasl/article/388/1/L49/978105)).
- **Tilted-annulus splat:** `gaussianRing(r_ellipse, R, w)` evaluated in
  tilted coords (§5.2 step 1) — shells, tori, photon rings.

### 6.1 `black-hole` (sprite version)

**Additive-sprite caveat first:** a sprite composited one/one cannot darken
the sky — the "shadow" only reads against the sprite's own disc/glow. For a
BH that genuinely occludes and lenses the starfield, the existing
positional `blackHoleLayer` is the tool; the sprite style is for *distant
decorative* BHs where the disc provides its own backdrop. Say this in the
UI tooltip.

Recipe (per-pixel, disc coords per §5.2 step 1 with `tilt` ~75°):

1. **Shadow:** hard zero inside `r < R_h` (screen-space circle), with the
   photon ring bleeding inward `exp(−((R_h − r)/(0.06·R_h))²)` — same
   trick as `LENS_FRAG`.
2. **Photon ring:** thin bright annulus at `R_p = 1.16·R_h` (matching the
   positional layer's constant), width `0.09·R_h`, color warm white
   `(1, 0.85, 0.6)`.
3. **Primary disc image:** annulus `R_in=2.2·R_h .. R_out=5..8·R_h` in
   tilted disc coords; radial profile and Doppler beaming copied from
   `DISC_FRAG`:

   ```
   t = (rd − R_in)/(R_out − R_in)
   I = amount · (0.18 + 0.85·(1 − t)^2.2) · (1 + doppler·0.9·sin(az))
   col = mix(kelvinToRgb(discKelvin), kelvinToRgb(0.4·discKelvin), t)
   ```

   plus streaky texture `× (0.8 + 0.2·fbm(az·8 + rd·3, rd·5))` (orbital
   smearing: stretch noise along azimuth ~3× vs radius).
4. **The "hat" (far-side image bent over the hole):** cheap Gargantua-style
   remap — for disc-plane points on the far side (`sin(az) > 0` in screen
   terms), draw a second image at

   ```
   x_img = xd · (1 − 0.12·(rd − R_in)/R_out)          // slight pinch
   y_img = −sqrt( (yd·cos(tilt))² + (1.25·R_h)² )      // bent over the top
   ```

   at 0.55× brightness and 0.6× thickness (evaluate by inverse-mapping per
   pixel in a band above the shadow: for pixels with
   `|y| ∈ [1.05·R_h, 2.2·R_h]` and `r < R_out`, solve
   `yd = sqrt(y² − (1.25·R_h)²)/cos(tilt)` and shade if
   `R_in < hypot(xd, yd) < R_out`). Mirror with a fainter (0.3×) arc below
   for the bottom secondary image. This is an art-directed approximation —
   documented as such — not GR.
5. Faint blue-white ambient glow `0.1·exp(−r/(3·R_h))`.

Params: `horizonRadius` (0.05..0.16 of sprite), `discInner/Outer` (R_h
units), `discKelvin` (6000..30000, default 12000), `doppler` (0..1, 0.7),
`tilt` (55..85), `photonRing` (0..1), `hat` (0..1).

### 6.2 `tde` — black hole eating a star (tidal disruption event)

Signatures from observation + art: a star stretched into a teardrop, a
long thin **debris stream** wrapping the hole (self-intersecting spiral),
hot inner accretion glow
([ESA TDE artist's impression](https://sci.esa.int/web/xmm-newton/-/56682-artist-s-impression-of-a-tidal-disruption-event),
[STScI TDE concept](https://www.stsci.edu/contents/media/images/2024/204/01HWX7QJVQKXMJQ0M2B8NVYHCC?news=true)).

1. Base: the §6.1 BH at small `R_h` with a compact hot disc
   (`R_out` ~3·R_h, `discKelvin` 20000 — TDE discs run hot/blue).
2. **Stream: a logarithmic spiral** from the victim star into the disc:

   ```
   r(θ) = r_star · exp(−k·θ),  θ = 0 .. wraps·2π,  k = ln(r_star/R_in)/(wraps·2π)
   ```

   Render as ~400 seeded particle splats along θ with:
   - width tapering inward: `σ(θ) = σ0·(0.25 + 0.75·r/r_star)`,
     jitter positions by `N(0, σ)` perpendicular to the curve;
   - color running cool→hot inward:
     `kelvinToRgb(mix(4500, 18000, 1 − r/r_star))`;
   - alpha rising inward (`0.06 → 0.2`) — the stream brightens as it
     circularizes;
   - a **self-intersection hotspot** where wrap 1 meets wrap 2 (θ ≈ 2π):
     one bright splat, white-blue — stream-stream collision is where TDEs
     light up ([Physics World on TDE flares](https://physicsworld.com/a/accretion-not-colliding-spaghetti-flares-up-as-star-is-devoured-by-black-hole/)).
3. **The star:** teardrop at spiral start — a gaussian core (radius
   `r_s` ~10 px, `kelvinToRgb(starKelvin)`) plus 5–8 progressively smaller
   gaussians marching along the first 60° of the spiral (metaball chain =
   spaghettification without any SDF work).
4. Faint tidal fan: 100 Plummer-sampled specks scattered ±25° around the
   outer spiral (unbound debris).

Params: `wraps` (0.8..2.5, default 1.5), `streamWidth`, `starKelvin`
(3500..6500), `starSize`, `hotspot` (0..1), plus the §6.1 BH params at
reduced ranges.

### 6.3 `multiple` — binary / trinary star sets

- 2 or 3 flare-style stars (gaussianCore + glow + optional spikes), seeded
  positions on a shared ellipse: separations 0.15–0.4 of sprite, kelvins
  drawn per star (classic pairs: blue-white + orange — high contrast reads
  best).
- **Contact-binary option** (`contact` 0..1): metaball bridge — evaluate
  `f = Σ_i exp(−d_i²/σ_i²)` per pixel along the inter-star band and add
  luminosity where `f` crosses a threshold; at high `contact` the two
  cores visibly neck together (Roche-lobe teardrop).
- Mutual illumination: each star's halo tinted 15 % toward the *other*
  star's color on the facing side (`dot(dir_to_other, dir_from_center)`
  gate).
- Optional `circumbinaryRing` (0..1): §5.1 dust ring around the pair's
  barycenter.
- Trinary: third star smaller (0.5× radius), placed on a wider orbit
  (hierarchical triple reads truthful; three equal stars in a line reads
  fake).

Params: `count` (2..3), `separation`, `kelvinA/B/C`, `sizeRatio`,
`contact`, `spikes`, `circumbinaryRing`.

### 6.4 `nova`

Signatures: a brilliant white point with a **small, young, sharp shell**
and strong spikes — "new star", not a big remnant.

- Core: `gaussianCore` at 0.8× brightness white, 4–6 `spike()`s, kelvin
  ~8000 (novae flash A–F white).
- Shell: one thin `gaussianRing(r, R_shell, 0.04)` at `R_shell` ~0.25 of
  sprite, alpha 0.5, two-tone: Hα red outer edge, pale yellow inner —
  ±5 % FBM radius wobble (nebula `shell` trick).
- Optional second fainter ring at 0.6·R_shell (previous outburst — light
  echo hint).
- `ejectaStreaks` (0..1): 8–16 short radial streaks (`spike()` at seeded
  angles, length ~R_shell, alpha 0.15) gated by angular noise.

Params: `shellRadius`, `shellAge` (maps to radius+alpha: young = small
bright, old = large faint), `streaks`, `kelvin`, `spikes`.

### 6.5 `supernova`

Signatures: blinding core, **two-shell structure** (outer thin blast
shock + inner clumpy ejecta), radial rays.

1. Core: white gaussian + long spikes (8, alternating lengths) + Sérsic
   n≈1 afterglow skirt (`sersicIntensity` — soft wide base).
2. **Outer shock shell:** thin limb-brightened bubble — the
   PCG-SAMPLES §2.7 path-length recipe:
   `I ∝ clamped 1/sqrt(1 − (r/R_s)²)` peaking at `r → R_s`, thickness
   ~0.05, blue-white, ±6 % FBM wobble.
3. **Inner ejecta:** ridged-FBM filaments (`1 − |fbm|` per octave,
   NEBULA-PCG §2.1) masked by `gaussianRing(r, 0.55·R_s, 0.18·R_s)`;
   two-channel color — Hα red filaments + OIII teal via decorrelated hue
   field (both recipes already in `nebulaGen.ts`).
4. **Rays:** 10–20 radial streaks through the shell, angular-noise gated
   (the corona streamer recipe with `reach` fixed high and thin
   `streak` gate) — the classic explosion starburst.
5. 30–80 Plummer-scattered hot specks between core and shell (reverse-shock
   knots).

Params: `shellRadius`, `ejectaAmount`, `rays`, `filamentContrast`,
`colorA/B` (default Hα/OIII), `coreBrightness`.

### 6.6 `kilonova`

Signatures: **two-component two-color ejecta** — fast blue lanthanide-poor
polar/outer flash + slower red lanthanide-rich equatorial torus
(AT2017gfo turned blue→red over days;
[rapid reddening of AT2017gfo](https://arxiv.org/pdf/1710.05853),
[kilonova simulations review](https://royalsocietypublishing.org/rsta/article/383/2295/20240119/234752/Kilonova-simulations-connecting-observations-with)).
A `phase` param (0 = day-1 blue, 1 = week-old red) is the style's soul.

1. Core: small intense white-blue gaussian, brightness `× (1 − 0.5·phase)`.
2. **Blue polar component:** two broad elongated gaussians (the beam
   primitive, `w0` wide ~25°, `L` ~0.35 sprite) along ±axis, color
   `kelvinToRgb(12000)`, alpha `× (1 − 0.7·phase)`.
3. **Red equatorial torus:** tilted annulus (tilt ~65°) at
   `R_t = 0.12 + 0.25·phase` (it expands), thickness 0.4·R_t, color
   `mix(kelvinToRgb(2600), {0.6,0.15,0.1}, 0.5)`, alpha
   `× (0.3 + 0.7·phase)`, clumped by 3-octave FBM.
4. Fast radial streaks (v ~0.3c ejecta): 12–24 fine lines from core
   through the blue lobes only.
5. Optional `gwHint` = 0 always — no chirp graphics; it's a light source,
   not an infographic (see §9).

Params: `phase` (0..1, default 0.35), `axisDeg`, `torusTilt`,
`blueAmount`, `redAmount`, `streaks`.

### 6.7 `quasar`

Signatures: star-like blazing core (it outshines its galaxy), **twin
relativistic jets with knots**, faint host-galaxy halo
([M87 jet knot structure](https://academic.oup.com/mnrasl/article/388/1/L49/978105),
[X-ray jets/lobes/hotspots review](https://arxiv.org/pdf/astro-ph/0301125)).

1. Core: gaussianCore (blue-white, kelvin 15000+) + 4 spikes + strong
   Sérsic n=4 glow skirt — deliberately "foreground star"-like.
2. **Jets:** two beam-primitive jets along ±axis with:
   - asymmetric brightness (`jetAsymmetry` 0..1, default 0.65: the
     counter-jet is Doppler-dimmed — one-sidedness is a signature, per
     M87);
   - 3–5 knots (knot-series recipe), knot color slightly bluer than the
     beam (synchrotron);
   - **terminal hotspot + lobe:** at `ℓ = L`, one bright compact gaussian
     (hotspot) inside a wider faint cocoon ellipse (lobe,
     radius ~0.25·L, alpha 0.08) — FR II furniture.
   - slight S-bend: offset `d` by `bend·sin(π·ℓ/L)·w(ℓ)` (`bend` 0..0.5).
3. Host halo: `sersicIntensity(r, 0.3·sprite, 1)` at alpha 0.12, warm
   gold — barely-there elliptical smudge behind the core.

Params: `jetLength`, `jetAngleDeg`, `jetWidth`, `knots` (0..6),
`jetAsymmetry`, `bend`, `hotspot` (0..1), `hostGlow`, `coreKelvin`.

### 6.8 `smbh-torus` — obscured AGN with dusty torus + jets

Signatures: the AGN unified-model doughnut seen at intermediate tilt —
warm-brown torus, bright core peeking through the hole, **ionization cones
+ polar jets** perpendicular to the torus
([AGN unified model](https://en.wikipedia.org/wiki/Active_galactic_nucleus),
[first direct torus image](https://www.sciencealert.com/feed-your-black-hole-fever-with-the-first-direct-image-of-the-dusty-donut-surrounding-one)).

1. **Torus:** in tilted disc coords, a revolved gaussian tube:

   ```
   ρ = hypot(rd − R_t, z_eff),   z_eff = y_screen_residual/max(0.15, sin(tilt))
   I_torus = exp(−(ρ/w_t)²) · (1 + 0.3·fbm(az·4, rd·5))   // clumpy
   ```

   Color it as *lit dust*: inner rim (facing core) warm orange
   `kelvinToRgb(2200)`, outer surface deep brown `{0.25,0.16,0.1}` —
   `mix` by `clamp((R_t − rd)/w_t)`. Remember additive: the torus never
   silhouettes the sky, it's a glowing donut; its "dark side" is simply
   dim. For the tilt range 25–60° the front rim naturally covers the core
   bottom — draw torus *after* core with `source-over` (not lighter) in a
   band below the midline so it genuinely occludes the core glow (the
   sprite composites internally on black, so source-over occlusion inside
   the bake is legitimate).
2. Core: compact intense white-blue gaussian in the torus hole + broad
   halo clipped by the torus pass.
3. **Ionization cones:** two wide (35–50°) faint teal wedges along the
   poles: `I = 0.1·exp(−ℓ/L)·smoothstep(cosHalfAngle, 1, cos(angle_from_axis))`.
4. Jets: §6.7's beam+knots at reduced alpha inside the cones.

Params: `torusRadius`, `torusThickness`, `tilt` (25..60), `clumpiness`,
`coneAngle`, `coneAmount`, `jetAmount`, `coreKelvin`.

### 6.9 `magnetar`

Signatures: tiny fierce star wrapped in **glowing dipole field-line
loops**, violet/teal palette
([ESA/Hubble magnetar impression](https://esahubble.org/images/heic2504a/),
[NASA magnetar illustration](https://science.nasa.gov/asset/hubble/illustration-of-magnetar/)).

1. Core: white-violet gaussian, radius ~6 px, + tight halo.
2. **Dipole field lines** — the real dipole field-line equation, drawn as
   strokes: a field line crossing the magnetic equator at radius `L`
   satisfies

   ```
   r(θ) = L · sin²θ        (θ = magnetic colatitude)
   ```

   For `L_i = L0·q^i` (i = 0..lines−1, q ≈ 1.45, 4–7 shells), sample θ from
   ~0.25 to π−0.25, compute `(r·sinθ, r·cosθ)` in the magnetic frame,
   rotate by `axisDeg`, and apply a fake 3D roll: draw each shell twice at
   azimuthal foreshortening `x·cos(ψ_j)` for ψ ∈ {±25°} so loops read as a
   cage, not a flat figure. Stroke with additive gradient (alpha
   0.25 → 0 outward along each line), color teal `{0.3,0.9,0.8}` for
   inner shells → violet `{0.6,0.4,1.0}` outer.
3. **Twist:** perturb sampled points by
   `fbm(θ·2, i·3)·twist·0.04·L_i` perpendicular to the line — stressed,
   about-to-flare field.
4. One or two bright loop-top hotspots (gaussian splats at θ = π/2 of a
   random shell) — magnetar burst hint.
5. Polar hot spots on the star (two tiny white caps where field lines
   converge).

Params: `lines` (3..8), `loopScale L0`, `axisDeg`, `twist` (0..1),
`hotspots` (0..2), `palette` (teal-violet default).

### 6.10 `pulsar` — neutron star with lighthouse beams

Signatures: pinpoint star, **two opposed narrow beams offset from the spin
axis**, plus (optionally) a Crab-style pulsar-wind inner ring/torus. The
beams come from the magnetic poles, misaligned with rotation — that
misalignment is the pulsar's whole identity
([lighthouse model diagram](https://www.researchgate.net/figure/The-rotating-neutron-star-or-lighthouse-model-for-pulsar-emission-Click-here-to-see_fig1_26386618),
[pulsar beam shape](https://arxiv.org/pdf/astro-ph/0010538)).

1. Core: 3–5 px white-blue point (kelvin 25000+), intense, tiny halo —
   the star itself is nearly invisible; the beams carry the sprite.
2. **Beams:** two hollow-cone elongated gaussians (shared primitive) at
   `beamAngle` and `beamAngle + 180°`, `w0` ~4 px, `wSlope` ~tan(6..14°),
   `L` ~0.45 sprite. Color `kelvinToRgb(20000)` fading to violet-white.
   Add faint internal striations: `× (0.85 + 0.15·fbm(ℓ·6, d·2))`.
3. **Spin-axis hint:** draw the *rotation* axis tilted `misalignDeg`
   (10..40°, default 25) from the beam axis as a very faint (alpha 0.06)
   thin line + a small tilted ellipse ring around the star perpendicular
   to it — the spin plane. Two axes visibly disagreeing = "pulsar", one
   axis = "generic jet". This is the single most identity-carrying detail.
4. **Wind torus** (`windTorus` 0..1, Crab-like): tilted annulus at
   ~0.18 sprite radius, teal-white, alpha 0.2, plus a fainter second ring
   at 0.6× — the Chandra Crab inner-ring/torus furniture.
5. Beam-sweep glow: two broad low-alpha cones (2× beam width, 0.25×
   alpha) behind the beams — time-averaged lighthouse smear.

Params: `beamAngle`, `beamLength`, `beamWidthDeg`, `misalignDeg`,
`hollowness` (0..1), `windTorus`, `coreKelvin`.

---

## 7. Proposed UI structure

Six modes in the Type select (StarsTab `GenKind`):
`star | sun | galaxy | nebula | planet | anomaly` — each mode's first
control is **Style** (SelectField), which applies its
`*_STYLE_DEFAULTS` preset and gates the per-style controls below it.

```
star     Style: classic | hst-spikes | jwst-spikes
         controls: core, spikes, spike len, angle, halo, kelvin  (existing FlareGenParams)

sun      Style: O | B | A | F | G | K | M
                | white-dwarf | red-dwarf | brown-dwarf
                | red-giant | red-supergiant | blue-giant
                | pulsar (→ anomaly baker)
                | dust-ring | solar-system
         always: seed, kelvin, disc size, limb dark, granules, corona,
                 cor. extent, prominences, glow            (existing)
         new shared: granule scale, ambient wisp, spikes
         dust-ring adds: ring inner/outer/tilt/opacity/kelvin
         solar-system adds: tilt, PA, gaps, gap ratio, gap width,
                            scatter, planets, disc kelvin

galaxy   Style (rename of Morphology): spiral | elliptical | edge-on
                | globular | interacting                   (existing params unchanged)

nebula   Style: nursery | dark-dust | wisp | shell         (unchanged)

planet   Style: rocky | gas-giant   (style sets banding 0 / 0.8; rings section unchanged)

anomaly  Style: black-hole | tde | multiple | nova | supernova
                | kilonova | quasar | smbh-torus | magnetar | pulsar
         always: seed
         per-style controls per §6 param lists
```

Existing-param reuse map: `kelvin`-family sliders drive every stellar
color; `discRadius/limbDarkening/granulation/corona/prominences/glow`
carry all 13 sun styles with only presets + the §4 style-gated branches;
`RingParams`/`drawRingSet` carries dust-ring, solar-system (gap variant),
and smbh-torus band drawing; `NebulaGenParams`' warp/contrast conventions
carry SN ejecta and ambient wisps.

Implementation notes:

- Keep serialized keys stable (`morphology` stays `morphology` in .sspj;
  only the UI label changes to Style).
- `SUN_STYLE_DEFAULTS: Record<SunStyle, Partial<SunGenParams>>` +
  `ANOMALY_STYLE_DEFAULTS` mirror `NEBULA_STYLE_DEFAULTS` exactly.
- The `G` style preset must reproduce today's `DEFAULT_SUN` output
  byte-for-byte (regression test: hash the baked canvas for a fixed seed —
  same pattern as `generators.test.ts`).
- Suggested naming default per style (`my-quasar.png` etc.) — the current
  `name` field already supports this.

---

## 8. Build order (cheapest-high-impact first)

**Phase 1 — taxonomy + spectral sequence (small)**
1. Rename UI labels to Style everywhere; add `style` to `SunGenParams`;
   `SUN_STYLE_DEFAULTS` for O B A F G K M; new params `granuleScale`,
   `ambientWisp`, `spikes`; limb-darkening/white-mix tweaks (§3).
   *Payoff: 7 new stars for ~1 file of presets.* Regression-test G ≡ old default.

**Phase 2 — dwarfs & giants (medium-small)**
2. `white-dwarf`, `red-dwarf`, `brown-dwarf` (§4.1–4.2): compact-glow
   branch, magenta override, banding reuse.
3. `red-giant`, `red-supergiant`, `blue-giant` (§4.3–4.4): two-scale
   mottle, limb wobble, rim-brightening term.

**Phase 3 — anomaly scaffold + point-source styles (medium)**
4. `src/gen/anomalyGen.ts` + beam/knot/annulus primitives + StarsTab mode.
5. `multiple`, `nova`, `pulsar` (§6.3, 6.4, 6.10) — mostly existing
   primitives; pulsar also wired as the sun-mode alias.
6. `supernova`, `magnetar` (§6.5, 6.9) — ridged filaments exist; dipole
   loops are the only new curve-stroking code.

**Phase 4 — disc systems (medium)**
7. `dust-ring` (§5.1) — extend `drawRingSet` ranges + scatter term.
8. `solar-system` (§5.2) — gap-series disc; the showpiece of this phase.

**Phase 5 — jets & hero anomalies (larger)**
9. `quasar` (§6.7) then `smbh-torus` (§6.8) — shares beams/knots/cones.
10. `black-hole` sprite (§6.1) — disc + photon ring + hat remap.
11. `tde` (§6.2) — builds directly on 10; log-spiral stream + metaball star.
12. `kilonova` (§6.6) — two-component ejecta with `phase`.

Each phase ships independently; test hashes per style (fixed seed →
canvas hash) as bakers land, mirroring `generators.test.ts`.

---

## 9. Explicitly NOT at sprite scale

- **Real gravitational lensing in a sprite.** A sprite has no knowledge of
  the sky behind it; the shadow/lens must stay in the positional
  `blackHoleLayer`. The sprite BH's "shadow" and "hat" are self-contained
  art (§6.1 caveat) — do not attempt background-dependent bending.
- **Darkening effects on additive layers.** Dust lanes, torus silhouettes,
  and BH shadows cannot subtract light from the sky when composited
  one/one. Inside-the-bake occlusion (source-over on black) is fine;
  sky-darkening requires the `dark` bake mode + multiply layer and should
  not be promised per-style.
- **Time variability.** Pulsar blinking, nova rise/decay, kilonova
  color evolution as *animation* — bakes are static; `phase`-style params
  (kilonova, nova `shellAge`) capture one moment instead.
- **Resolved planet discs in `solar-system`.** Planets are 1–2 px points
  in gaps, never rendered spheres — at skybox angular sizes anything
  bigger reads as a second star. (Same logic that removed the standalone
  pillars nebula style.)
- **Photon sub-rings / GR-accurate isoradial curves** on the sprite BH —
  invisible below several thousand px; one ring + one hat arc is the
  correct budget.
- **N-body TDE debris or SPH streams** — the analytic log-spiral +
  jittered splats is indistinguishable at 384–1024 px; the restricted
  3-body integrator stays a galaxy-scale tool.
- **Magnetar field-line physics beyond the dipole formula** (force-free
  twisted magnetospheres) — `r = L sin²θ` + noise twist is the whole
  visual.
- **Spectral-line palettes for anomalies** (X-ray false color, narrowband
  channel splits) beyond the fixed tints specified — keep the two-color
  params the nebula generator already established.
- **Host-galaxy detail behind quasars/SMBHs** — a Sérsic smudge only; a
  full galaxy bake behind a jet doubles cost for pixels the core glow
  washes out anyway.

---

## Sources

- [Wikipedia — Stellar classification (MK system, temperature/color table)](https://en.wikipedia.org/wiki/Stellar_classification)
- [Star Facts — Types of stars, class temperature ranges](https://www.star-facts.com/types-of-stars/)
- [A&A — Radiative hydrodynamics simulations of red supergiant convection (Betelgeuse giant cells)](https://www.aanda.org/articles/aa/full_html/2010/07/aa13907-09/aa13907-09.html)
- [arXiv:1003.1407 — Betelgeuse convection simulations match interferometry](https://arxiv.org/abs/1003.1407)
- [RNAAS — Brown Dwarfs are Violet: human-eye colors of substellar objects](https://iopscience.iop.org/article/10.3847/2515-5172/ac225c)
- [Wikipedia — Brown dwarf (magenta appearance, Na D absorption)](https://en.wikipedia.org/wiki/Brown_dwarf)
- [AAS Nova — Gaps in HL Tau's protoplanetary disk (13/32/63 AU)](https://aasnova.org/2016/12/19/selections-from-2016-gaps-in-hl-taus-protoplanetary-disk/)
- [ApJL — Gas gaps in the protoplanetary disk around HL Tau](https://iopscience.iop.org/article/10.3847/2041-8205/820/2/L25)
- [arXiv:1901.03680 — Protoplanetary disk rings and gaps across ages and luminosities](https://arxiv.org/abs/1901.03680)
- [arXiv — Revisiting the shape of pulsar beams (hollow cone + core)](https://arxiv.org/pdf/astro-ph/9904336)
- [arXiv — The shape of pulsar radio beams](https://arxiv.org/pdf/astro-ph/0010538)
- [ResearchGate — Lighthouse model diagram (misaligned magnetic/rotation axes)](https://www.researchgate.net/figure/The-rotating-neutron-star-or-lighthouse-model-for-pulsar-emission-Click-here-to-see_fig1_26386618)
- [ESA — Artist's impression of a tidal disruption event](https://sci.esa.int/web/xmm-newton/-/56682-artist-s-impression-of-a-tidal-disruption-event)
- [STScI — Tidal disruption of a star (artist's concept)](https://www.stsci.edu/contents/media/images/2024/204/01HWX7QJVQKXMJQ0M2B8NVYHCC?news=true)
- [Physics World — TDE flares from stream self-intersection / accretion](https://physicsworld.com/a/accretion-not-colliding-spaghetti-flares-up-as-star-is-devoured-by-black-hole/)
- [arXiv:1710.05853 — Rapid reddening of AT 2017gfo (kilonova blue→red)](https://arxiv.org/pdf/1710.05853)
- [Phil. Trans. R. Soc. A — Kilonova simulations: connecting observations with physics](https://royalsocietypublishing.org/rsta/article/383/2295/20240119/234752/Kilonova-simulations-connecting-observations-with)
- [MNRAS Letters — Two-zone synchrotron model for the knots in the M87 jet](https://academic.oup.com/mnrasl/article/388/1/L49/978105)
- [arXiv — X-ray emission from extragalactic jets, lobes and hotspots](https://arxiv.org/pdf/astro-ph/0301125)
- [Wikipedia — Active galactic nucleus (unified model, dusty torus)](https://en.wikipedia.org/wiki/Active_galactic_nucleus)
- [ScienceAlert — First direct image of an AGN dusty torus](https://www.sciencealert.com/feed-your-black-hole-fever-with-the-first-direct-image-of-the-dusty-donut-surrounding-one)
- [ESA/Hubble — Magnetar artist's impression (field-line loops)](https://esahubble.org/images/heic2504a/)
- [NASA — Illustration of magnetar](https://science.nasa.gov/asset/hubble/illustration-of-magnetar/)
- This repo — `docs/StellarObjects.md` (user draft: sensory signatures +
  Three.js blueprint, mapped in §1b), `docs/NEBULA-PCG-RESEARCH.md`, `docs/PCG-SAMPLES-RESEARCH.md`,
  `docs/MODERN-LOOK-RESEARCH.md`, `src/gen/generators.ts`,
  `src/gen/galaxyMorph.ts`, `src/gen/nebulaGen.ts`, `src/gen/profiles.ts`,
  `src/render/blackHoleLayer.ts`, `src/render/proceduralFlares.ts`
