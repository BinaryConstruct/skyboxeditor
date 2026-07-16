# Black-hole geodesic rendering research

Sources studied (2026-07-16):

- **HollowaySean/BlackHoleViz_v2** (Unity compute, MIT) — full relativistic ray
  tracer: `Assets/Shaders/BlackHole/SchwarzchildUpdate.compute` (also Kerr).
- **hexontos/rendering-black-hole** (WebGPU/WGSL) — `src/gpuPipeline.wgsl`,
  planar-geodesic real-time tracer.

Local copies of the studied sources were reviewed in-session; both repos are
small and easy to re-fetch.

## What each does

### BlackHoleViz_v2 — the physics/shading reference

Integrates null geodesics in Schwarzschild spherical coordinates `(r, θ, φ)`
with RK4, adaptive step size (fine near horizon/poles, `r²`-scaled when
receding), and cheap early exits:

- horizon capture: inside photon sphere `r < 1.5 rs`, or impact parameter
  `C > 27/4 rs²` while infalling;
- disc hit: detected as a **hemisphere change of θ between steps** with
  `r_avg` inside `[1.5 rs, diskMax]` — no thin-disc raycast needed.

Its **disc shading model** is the valuable part for us:

```
T(r)     = diskTemp * (3 rs / r)^0.75          // Novikov–Thorne-like profile
v(r)     = sqrt(rs / (2 r))                     // Keplerian orbital speed
γ        = 1 / sqrt(1 - v²)
shift    = γ (1 + v · incidence)                // special-relativistic Doppler
I       *= shift^beamExponent                   // relativistic beaming
shift   *= sqrt(1 - rs / r)                     // gravitational redshift
color    = Blackbody LUT (shift, T)             // 2D lookup
I       *= (T / diskTemp)^4                     // Stefan–Boltzmann weighting
```

The disc *body* is volumetric FBM density marched with absorption
(`exp(-absorption · densitySum · step)`), and the noise field is **twisted by
radius** (`phase += circulation · rNorm`) and rotated at Keplerian speed with a
time-delay factor — that's what produces streaky differential-rotation spiral
texture instead of a uniform smear.

### hexontos — the integration technique to port

Key trick: a null geodesic around a Schwarzschild hole stays in the **2D
orbital plane** spanned by the BH-relative ray origin and ray direction. So per
pixel:

1. `buildOrbitalPlane`: radial axis = normalize(origin−BH), plane normal =
   origin×dir, tangential axis = normal×radial (degenerate case → fallback).
2. Reduce the ray to planar state `(r, φ, dr/dλ, dφ/dλ)` plus conserved energy
   `E = f·dt/dλ`, where `f = 1 − rs/r`.
3. Integrate the planar ODE with RK4 (or a cheap Euler "fast step"):
   ```
   r'    = dr
   φ'    = dφ
   dr'   = -(rs / 2r²) f (E/f)² + (rs / 2r²f) dr² + (r − rs) dφ²
   dφ'   = -2 dr dφ / r
   ```
4. Map back to 3D (`r cosφ · radial + r sinφ · tangential`) per segment; test
   segment against the disc plane / horizon sphere; on escape, use the outgoing
   world direction to sample the background.

State is 4 floats + E — tiny, branch-light, and fragment-shader friendly. The
whole tracer is ~120 lines of WGSL, directly portable to GLSL3.

## How this maps onto spacescape-web

We render black holes in two places:

1. **Positional lens layer** (`src/render/blackHoleLayer.ts`): screen quad over
   the BH footprint, point-lens deflection `β = θ − θE²/θ` applied to a scene
   cubemap capture, plus a *synthetic* painted photon ring and shadow disc.
2. **PCG sprite baker** (`src/gen/anomalyGen.ts` `bakeBlackHole`): CPU canvas,
   hand-painted near/far disc halves and an elliptical "arc hat" approximating
   the lensed far side.

### Adaptation plan (proposed, in value order)

**A. Disc shading upgrade (cheap, both paths, no geodesics needed).**
Replace flat `discKelvin` coloring with the BlackHoleViz model: per-pixel
`T(r) ∝ r^-0.75`, `kelvinToRgb(T · shift)`, Doppler `γ(1+v·incidence)` with a
beaming exponent (replaces our crude linear doppler smear), gravitational
redshift dimming toward the ISCO, Stefan–Boltzmann intensity. Add the
radius-twisted FBM density (`phase += circulation · rNorm`) for spiral streaks.
All CPU-side in the baker; determinism preserved (PerlinNoise streams).

**B. Geodesic sprite baker (replaces the arc-hat approximation).**
Port the hexontos planar integrator to TypeScript inside `bakeBlackHole`:
camera ray per pixel → orbital plane → ~64 RK4 steps → segment/disc-plane
crossing (accumulate several crossings: primary image, far-side "hat" above
and below, photon-ring images arise *naturally*) → shade with (A). Cost at
384²·64 steps ≈ 10M RK4 evaluations ≈ well under a second; 1024² a few
seconds — acceptable for an explicit bake. Deletes the hand-painted hat code.

**C. Deflection LUT for the lens shader (exact bending at today's runtime
cost — NO per-frame ray tracing).**
Key symmetry: a non-spinning lens is radially symmetric, so the entire
geodesic result is a **1D function of the view angle θ** from the BH center.
Integrate ~512 planar geodesics ONCE on the CPU (TypeScript, the same
integrator as (B), milliseconds of work at layer-build time), and pack into a
small 1D texture:

- `deflection(θ)` — true bend angle to apply to the capture-sample direction
  (replaces `β = θ − θE²/θ`; identical in the weak field, exact in the
  strong field);
- capture flag — rays that spiral in (θ below the true shadow angle) go
  black, giving the real shadow edge;
- near the photon-ring angle, `deflection(θ)` sweeps through >π windings —
  the ring becomes real *lensed imagery of the captured scene* instead of the
  painted synthetic ring, for free in the same lookup.

Fragment shader change is one texture fetch replacing one formula — per-frame
cost is unchanged from today. Bake path uses a finer LUT for the higher
capture resolution.

**D. Not worth adapting:** per-fragment geodesic marching in the live lens
shader (real-time ray tracing — the LUT gets the same image for a static
Schwarzschild lens at zero marching cost), BlackHoleViz's Kerr integrator
(frame dragging breaks the radial symmetry the LUT relies on, and doubles
state), its progressive-accumulation architecture (we bake), and hexontos's
grid/starfield demo scaffolding.

### Performance stance

Everything above is bake-time or build-time CPU work; nothing adds per-frame
GPU cost:

- (A) disc shading: arithmetic inside the existing CPU sprite bake.
- (B) geodesic sprite bake: one-time explicit bake; 384²×64 RK4 steps ≈ 10M
  evaluations, well under a second; 1024² a few seconds behind the existing
  bake button.
- (C) LUT: ~512 CPU geodesics at layer build (~ms), then the lens shader does
  a 1D texture fetch where it currently evaluates the point-lens formula.

Live per-fragment geodesic marching was considered and rejected as
unnecessary for a static lens (see D).

### Risks / notes

- LUT resolution near the photon-ring angle: deflection diverges
  logarithmically there, so sample the LUT non-uniformly (dense near the
  critical angle) or the ring aliases.
- Adaptive step from BlackHoleViz (`r²`-scaled when receding, fine near
  horizon) if 64 uniform steps miss the ring in the CPU integrator.
- The lens capture is LDR; strong beaming wants headroom — disc shading is
  computed at bake so it can exceed capture range before tone-down.
- License: both MIT/permissive; we re-derive equations rather than copy code.
