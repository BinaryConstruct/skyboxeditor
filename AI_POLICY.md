# AI Policy

**BinaryConstruct Skybox** is a free, fully client-side tool. This document
states how AI relates to the project, plainly.

## How this software was built

The codebase is developed with substantial AI assistance (agentic coding
tools), directed and reviewed by the maintainer. All changes pass the
project's deterministic test suite and visual verification before release.

## What the app does — and does not — do

- **All generation is algorithmic, not model-based.** Nebulae, stars,
  galaxies, and black holes are produced by seeded procedural math (Perlin
  noise, blackbody physics, geodesic ray tracing). No diffusion or image
  model is involved, so identical seeds always produce identical output.
- **Nothing leaves your browser.** The app makes no network calls to AI
  services (or any backend). Scenes, sprites, and exports stay on your
  machine unless you share them.
- **You own your output.** Skyboxes you export are yours, for any use,
  commercial or otherwise. Attribution is appreciated, never required.

## Using AI to author scenes

The scene format is designed to be AI-friendly on purpose: the whole scene is
a single JSON document with a published schema
(<https://skyboxeditor.com/schema/scene.v2.schema.json>), editable live in the
app's **Script** tab with line-precise error messages. See
[`.claude/skills/skybox-scenes/SKILL.md`](.claude/skills/skybox-scenes/SKILL.md)
for a guide written for AI assistants (and humans).

## Contributions

AI-assisted contributions are welcome under the same bar as any other:
they must pass tests and review, and the contributor is responsible for the
submission's correctness and licensing.
