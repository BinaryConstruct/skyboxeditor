# Vision & Positioning

*2026-07-15. The goal-alignment reference — measure feature ideas against this.*

**Spacescape-web is a free, web-based authoring tool that makes baked space
skybox assets — fast, reproducibly, engine-agnostically — and hands them over
in formats that just import (UE 5.8, Godot 4, anything that reads
PNG/EXR/HDR).**

## The market reality this is built on

Couldn't a tech artist do this in Unreal? Sure — once, for one engine, slowly,
and nobody else on the team can touch it. The honest landscape:

- **Modern games mostly ship baked HDR cubemaps/panoramas, even in AAA.** A
  baked sky is one texture fetch per frame, identical on every platform, feeds
  reflection captures and light probes, and doesn't burn a tech artist on a
  raymarch material. Runtime-procedural skies are reserved for games whose
  *design* needs infinite variety (No Man's Sky, Elite). EVE — the gold
  standard for space skies — bakes offline.
- So the live problem is **"who authors the baked texture, and how painful is
  it"** — and the current answers are dated: the 2010 Spacescape, Photoshop
  star brushes, Blender one-offs, wwwtyro/space-3d.

## Where the value is (invest here)

1. **The authoring loop, not the rendering tech.** Engine material graphs are
   terrible at this job: no layer stack, no seeded determinism, slow
   iteration, and a UE material is useless to a Godot project. The moat is a
   live layer-stack editor with seeds, presets, and one-click HDR export to
   *both* engines. This is a workflow product, not a shader demo.
2. **The proc-gen workbench.** Parameterized galaxies/planets/flares that a
   non-tech-artist can art-direct, baked to reusable sprites. No engine gives
   them that.
3. **What flat baked images can't do — per-layer & data export.** Separated
   nebula layers + `composite.json` + stars/galaxies **as data** (positions,
   colors, sizes → Niagara / GPUParticles). Baked backdrop + engine-native
   foreground elements is a hybrid neither pure baking nor pure runtime
   materials offers — and it keeps the no-plugin promise.
4. **Batch/variation generation** (sleeper feature): "20 seeds of this preset
   at 2K" for games with many systems/regions. Trivial here (everything is
   deterministic), miserable in an engine.

## What NOT to chase (anti-goals)

- **Runtime engine skies** — animated volumetrics at 60 fps in-engine. That is
  engine-plugin territory (explicitly ruled out), and engines always win on
  their own turf. Animation belongs in the tool's preview and, at most, as
  optional plain-text shader exports.
- **Engine plugins or content packs of any kind.** The export contract is
  plain files that import natively.
- **Anything that requires a server.** Free, static, client-side.

## The one-line test for new features

*Does this make the authoring loop faster, the output more reusable across
engines, or the variety cheaper to produce?* If none of the three: skip it.
