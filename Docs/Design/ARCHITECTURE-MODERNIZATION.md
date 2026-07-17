# Spacescape Modernization Plan — Web / WebGL2 Port

**Decision (2026-07-15):** Port Spacescape (Alex Peterson, MIT, Qt4 + Ogre3D, 2010) to a
browser-based tool: **TypeScript + WebGL2 + three.js**, static hosting, no server required.
Goals: easy to use (zero install, shareable URL), modern UX, **dynamic/animated content**
in addition to baked skyboxes, and backward compatibility with existing `.xml` save files.
**Consumer engines: Unreal 5.8 and Godot 4** — all export formats target these two.

## 1. What the original actually is

| Component | Lines | Fate |
|---|---|---|
| `SpacescapePlugin` layer logic (noise/points/billboards + plugin orchestration) | ~2,800 | **Port** — this is the whole product |
| GLSL FBM + ridged-FBM fragment shaders (strings in `SpacescapeNoiseMaterial.cpp`) | ~250 | **Port nearly verbatim** to GLSL ES 3.00 |
| Vendored TinyXML / ticpp | ~5,000 | Drop — `DOMParser` |
| Qt shell + QtPropertyBrowser + Ogre widget | ~2,000 + vendored | Drop — web UI |
| `media/` flare textures (PNG + EXR), `save/*.xml` presets, `stars.csv` | — | Carry over as assets/presets |

### Layer model (the domain core)
- **noise** — seeded Perlin FBM or ridged-FBM rendered to a cubemap. Params: seed, octaves,
  gain, lacunarity, offset (ridged), scale, power, shelf (threshold), dither, inner/outer
  color, src/dest blend factors. GPU path renders 6 faces with perm-table + gradient
  lookup textures; a CPU path exists but the GPU path is canonical.
- **points** — N star point-sprites on random cube-face positions, optionally
  density-masked by a separate noise cubemap (rejection sampling: keep point if
  `rand() < n²`). Color lerps near→far by random distance.
- **billboards** — textured quads (flares) randomly placed, also maskable.
- Layers composite back-to-front with per-layer GL blend factors (`one`,
  `src_alpha`, `one_minus_src_alpha`, `dest_colour`, …) — maps 1:1 to
  `gl.blendFunc` / three.js `CustomBlending`.

### Determinism / backward compatibility
- Only RNG is C `srand()/rand()` (MSVC LCG: `seed = seed*214013 + 2531011;
  return (seed>>16) & 0x7FFF`). Reimplement exactly → identical perm tables,
  star positions, and colors for a given seed.
- Perlin perm table: identity 0..255, then Fisher-Yates-ish swap using `rand()%256`
  (see `SpacescapeLayer::initNoise`). Port exactly.
- Save format: flat XML `<layer><param>value</param>…</layer>` — keep import forever;
  adopt JSON as the native v2 format with an XML importer.

## 2. Target architecture

```
spacescape-web/            (new repo — this folder is reference only)
├─ src/
│  ├─ core/               # engine-agnostic, fully unit-testable
│  │  ├─ rng.ts           # MSVC LCG
│  │  ├─ perlin.ts        # perm table init, CPU reference noise
│  │  ├─ layers/          # typed param models + defaults (match C++ ctors)
│  │  └─ io/              # legacy XML import, JSON v2 save/load
│  ├─ render/             # three.js: cube RTT per noise layer, points,
│  │  │                   # billboards, blend compositing, preview scene
│  │  └─ shaders/         # fbm.frag, ridged.frag (ported), sky preview
│  ├─ export/             # PNG faces, zip, EXR (three EXRExporter),
│  │                      # equirect, Godot/Unity live-shader emitters
│  └─ ui/                 # React: layer stack + inspector + toolbar
├─ presets/               # save/*.xml converted + originals
└─ public/media/          # flare textures
```

- **Build**: Vite + TypeScript strict. **Render**: three.js (`WebGLCubeRenderTarget`,
  `CubeCamera`, `ShaderMaterial`, `Points`). **UI**: React (matches OST stack).
- **Hosting**: static — homelab Caddy/NPMplus or GitHub Pages. PWA manifest for
  offline use. No backend in v1; optional later: shareable preset permalinks
  (params fit in a URL hash — no server needed even for that).

## 3. Phases

### Phase 0 — Golden masters (before any code)
Run the old `Spacescape.exe` on each of the 6 bundled saves; export cubemaps at a
fixed size. These are the regression references. Bank them in the new repo.

### Phase 1 — Deterministic core (pure TS, no GPU)
MSVC LCG → perm table → CPU Perlin/FBM/ridged; layer param models with defaults
copied from the C++ constructors; legacy XML importer + JSON v2 round-trip.
Unit tests: perm table for seed 0/1/…, star positions for a points layer,
XML→model→XML fidelity on all 6 presets.

### Phase 2 — Rendering parity
Port the two fragment shaders to GLSL ES 3.00 (mechanical: texture lookups and
uniforms carry over). Noise layer → 6-face cube RTT with perm/grad textures.
Points layer → `gl.POINTS` with per-vertex color (fallback to instanced quads if
`gl_PointSize` limits bite). Billboards layer. Blend-factor compositing into a
preview cubemap; orbitable skybox preview. Acceptance: side-by-side vs golden
masters on all presets — perceptually identical (GPU float rounding will differ
slightly; original CPU/GPU paths didn't match each other either).

### Phase 3 — UI
Layout: **viewport-first, single clean sidebar** (right), top toolbar.

- **Toolbar**: new/open/save, preset gallery, undo/redo, preview resolution,
  HDR toggle, export button, animation play/pause + time scrub.
- **Sidebar, top half — layer stack**: drag-to-reorder list, back-to-front.
  Per row: type icon, name (rename inline), visibility eye, solo, duplicate,
  delete. "Add layer" button opens a categorized menu (Backgrounds: nebula,
  star field, flares, galaxy · Objects: sun, binary star, planet, black hole).
- **Sidebar, bottom half — inspector** for the selected layer: collapsible
  groups (**Shape/Placement · Noise · Color · Mask · Animation · Blending**),
  every scalar a slider **with** numeric entry field, seed fields with a 🎲
  re-roll button, gradient-ramp editor for colors (upgrade from the original's
  two-color lerp), tooltips explaining each param.
- Live preview: debounced re-bake of only the dirty layer (each layer owns its
  RTT; compositing is cheap). Drag-drop legacy `.xml` anywhere to import.
- Presets seeded from `save/`; every layer type ships with 2–3 named presets so
  "add galaxy" looks good immediately.

### Phase 3a — Layer taxonomy (v1 = parity, v2 = celestial objects)
**v1 (parity with original):**
| Layer | Key controls |
|---|---|
| **Nebula** (noise) | noise type (fbm / ridged / domain-warp*), seed, octaves, gain, lacunarity, offset, scale, power, shelf, dither, color ramp, blend factors, drift/evolution speed* |
| **Star field** (points) | count, size range, near/far color, twinkle amount+speed*, optional noise mask (full noise sub-panel, as original) |
| **Flares** (billboards) | texture picker (bundled flare set + user upload), count, size range, tint, noise mask |

**v2 (new positional/object layers — each placed on the sky sphere with
direction + apparent size, rendered into the same cubemap stack):**
| Layer | Key controls |
|---|---|
| **Galaxy** | arm count, pitch/tightness, bulge size+color, disc tilt/orientation, star density, dust-lane amount+color, core glow — implemented as billboard cloud + density function |
| **Sun** | direction, size, color temperature, corona params, glow/flare intensity; exports a matching directional-light entry in params JSON so engine lighting agrees with the sky |
| **Binary star** | two sun param sets + separation, orbit period, orbit plane angle — animated |
| **Planet** | direction, size, surface (noise params or texture), atmosphere rim color/width, lighting phase auto-derived from sun layer(s), optional rings (inner/outer radius, color, tilt) |
| **Black hole** | direction, horizon radius, lensing strength, accretion disc color ramp/temperature + tilt, photon-ring intensity |

*starred items are new since the original.

Rendering note: the **black hole is a post-pass, not a paint layer** — lensing
must sample the *already-composited* cubemap behind it and warp it, then draw
the disc/ring on top. So the compositor supports two layer kinds: *additive
paint layers* (everything else) and *distortion layers* that consume the
composite below them. This also cleanly maps to engines: in Godot/UE the lens
effect exports as a screen-space or sky-shader distortion using the same math.

### Phase 4 — Export
- Composited skybox: 6 face PNGs at 512–4096 (zip download), single cross-layout
  PNG, equirect PNG.
- HDR: float render targets (`EXT_color_buffer_float`, universal on desktop
  WebGL2) → EXR via three.js `EXRExporter`, or RGBE `.hdr`.
- **Per-layer asset export** — each layer already renders to its own cube RTT, so
  export any subset as standalone art assets for custom compositing in-engine:
  - Each noise/billboard layer as its own cubemap **with alpha** (noise value in
    alpha, not pre-blended), so engines can tint, mask, or re-blend freely.
  - A `composite.json` sidecar recording layer order + src/dest blend factors +
    colors, so the original look is reproducible from the separated assets.
  - **Point-star layers as data, not pixels**: JSON/CSV of unit-sphere positions,
    colors, and sizes — feed an engine-native particle/multimesh system instead
    of baking stars into the image (crisper, and enables engine-side twinkle,
    parallax, or LOD).
- Face naming/orientation presets targeting the two consumer engines
  (see §3a): **Unreal 5.8** and **Godot 4**.

### Phase 4a — Engine-ready file exports (UE 5.8 + Godot 4 — **no plugins**)
The export contract is **plain files that import natively**; nothing to install
in either engine.

- **Godot 4**: equirect `.exr`/`.hdr` → drop into `PanoramaSkyMaterial`; or
  6-face / cross-layout PNG-EXR for `Cubemap` import. Correct face order and
  orientation preselected by an "export for Godot" profile.
- **Unreal 5.8**: equirect `.hdr` (RGBE) → imports directly as `TextureCube`
  (long-lat is UE's native cubemap import path). HDR range preserved so
  skylight capture works. "Export for Unreal" profile handles naming and any
  vertical-flip/orientation differences.
- **Per-layer exports** (same profiles): alpha cubemaps/equirects per layer +
  `composite.json`, and point-star **data** as JSON/CSV — all engine-neutral
  files usable in a UE material graph / Niagara or Godot shader / MultiMesh as
  the user sees fit.
- **Optional, plain-text extras (not plugins)**: a generated `.gdshader` file
  (Godot treats it as a regular text asset — paste in and it works) and an HLSL
  snippet suitable for a UE `Custom` material node, for users who want the
  animated version in-engine. These are conveniences on top of the texture
  contract, never a dependency of it.
- Verification: each release, manually import the exported files into a scratch
  UE 5.8 and Godot 4 project and eyeball seams/orientation — cubemap face
  conventions are the classic silent failure here.

### Phase 5 — Dynamic content (the new value)
- Add **time** as a noise dimension (4D simplex or domain-warp drift) →
  nebulas that slowly evolve; per-layer drift velocity/rotation.
- Star twinkle (per-point phase in a vertex attribute), pulsing flares.
- Optional new layer types: domain-warped nebula, galaxy spiral (billboard
  cloud with density function), sun/star with corona.
- Animation lives **in the tool** (preview + baking); engines consume plain
  texture exports (Phase 4a). For users who want in-engine animation, the
  optional text exports (`.gdshader` file, HLSL `Custom`-node snippet) carry
  the same math — but baked textures remain the primary, zero-dependency path.

### Phase 6 — Polish & ship
PWA/offline, URL-hash preset sharing, docs page, deploy. Optionally seed the
preset gallery with community presets from the original's forum era.

## 4. Risks / notes
- **Point sprites**: max `gl_PointSize` varies by GPU (often 64–255, sometimes
  more). Original uses small sizes (1–4 px typical) — fine; keep instanced-quad
  fallback for large sizes.
- **EXR flare textures**: three.js `EXRLoader` handles the two bundled HDR flares.
- **Prior art**: wwwtyro/space-3d (WebGL skybox generator) — useful reference for
  cube RTT + export plumbing, but Spacescape's layer/blend model is richer.
- **License**: original is MIT — port freely with attribution in an ABOUT/credits.
- WebGPU is *not* needed for v1; WebGL2 covers everything. Revisit only if
  volumetric (raymarched) nebulas become a goal.
