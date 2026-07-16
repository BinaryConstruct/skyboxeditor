# Golden masters (Phase 0)

Reference exports from the original `Spacescape.exe` (in `../spacescape-0.5.1/`),
used as the parity target for Phase 2 rendering.

**How to capture (manual, once per preset):**

1. Run the original `Spacescape.exe`.
2. File → Open → load a preset from `spacescape-0.5.1/save/` (e.g. `purple-nebula-complex.xml`).
3. File → Export Skybox → 6 individual faces, **1024×1024**, PNG.
4. Save into `golden/<preset-name>/` (e.g. `golden/purple-nebula-complex/`),
   keeping the exporter's face-suffix names (`_front`, `_back`, `_left`,
   `_right`, `_top`, `_bottom`).
5. Repeat for all 6 presets. For `hdr1.xml`, additionally export EXR/HDR if the
   exporter offers it.

Notes:
- Do not resize or re-encode the exports; byte-exact PNGs straight from the app.
- The comparison in Phase 2 is perceptual (small GPU float differences are
  expected — the original's own CPU and GPU paths didn't match exactly either).
