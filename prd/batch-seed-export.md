---
task: Batch seed export — N deterministic variations in one zip
status: complete
progress: 10/10
created: 2026-07-15
updated: 2026-07-15
---

## Problem

VISION.md pillar 4: games with many systems/regions need cheap sky variety
("20 seeds of this preset at 2K"). Everything in the tool is deterministic
per seed, but the export panel bakes exactly one skybox per click — producing
20 variations means 20 manual seed edits and 20 downloads.

## Goal

The export panel bakes N seed-variations of the current visible layer stack
in one click and downloads a single zip: each variation's selected formats
under its own folder, plus a manifest recording the seeds so any variation
can be reproduced exactly.

## Out of Scope

- Per-layer / data export (task #2, separate PRD).
- Varying anything other than layer seeds (no palette/param jitter).
- Parallel or worker-based baking; variations bake sequentially.
- Batch UI outside the existing export panel.

## Criteria

- [x] C1: Export panel offers a Variations count, 1–32, default 1
- [x] C2: Variations = 1 takes the existing single-export code path unchanged
- [x] C3: Batch bake downloads one zip with per-variation folders (v01/, v02/, …)
- [x] C4: Same preset + variation index yields identical seeds across runs
- [x] C5: Variation 1 uses the preset's original layer seeds unchanged
- [x] C6: Zip contains manifest.json with preset, size, and per-variation layer seeds
- [x] C7: Non-seed layer parameters are identical across all variations
- [x] C8: Export button reports per-variation progress during a batch bake
- [x] C9: Anti: no Math.random in the batch path — variations stay reproducible
- [x] C10: Anti: existing test suite stays green (62 tests pre-change)

## Decisions

- 2026-07-15: Variation k re-seeds each layer with a pure integer hash of
  (layer seed, k) — Knuth multiplicative — rather than a shared RNG stream,
  so a variation's seeds don't depend on layer order or count.
- 2026-07-15: k = 0 returns the original seed verbatim so the first batch
  variation is exactly the authored preset.
- 2026-07-15: points/billboards mask seeds must vary too (found during
  verification against the preset XML — otherwise star-clump placement is
  frozen across variations); maskSeed is salted (xor 0xa5a5) before hashing
  so a layer whose maskSeed equals its seed still varies independently.

- 2026-07-15: Codex review, both findings fixed: (1) large batches could OOM
  the tab (entries held in RAM + zipSync doubling) — batch now stops adding
  variations past a ~1 GB entry budget, notes `truncatedAfter` in the
  manifest, and tells the user; (2) `variantSeed` coerced to uint32 *before*
  the k = 0 identity check, so imported seeds outside uint32 (e.g. -1)
  wouldn't round-trip in variation 1 — identity now returns verbatim.

## Verification

End-to-end evidence from driving the built app (vite preview :4189) with
Playwright on 2026-07-15: opened the export panel, set 512/equirect-PNG,
Variations = 3, clicked "Bake 3 variations", captured the download — twice.

- C1: App.tsx export panel `Variations` number input, min 1 max 32, clamped; default `useState(1)`.
- C2: `runExport` branches to `runBatchExport` only `if (exportBatch > 1)`; the single path is untouched.
- C3: downloaded `purple-nebula-complex-batch3-512.zip` contains `v01/ v02/ v03/` each with `purple-nebula-complex-equirect.png`, plus `manifest.json`.
- C4: the two independent downloads are **byte-identical** (`diff -r` clean); `variantSeed` locked-value unit tests (1399529528 / 2172431747 / 1969654179).
- C5: manifest v1 layerSeeds `0,0,0,0,0,1,2,9,…` + maskSeed 2 match `presets/purple-nebula-complex.xml` `<seed>`/`<maskSeed>` order exactly.
- C6: manifest.json quoted above — preset, faceSize, per-variation `{name, seed, maskSeed?}`.
- C7: unit test "re-seeds every layer, leaves everything else identical" (deep-equal with seeds zeroed); 71/71 tests green.
- C8: bake button renders `Baking ${batchProgress}…` from `setBatchProgress(\`${k+1}/${count}\`)` per iteration.
- C9: `rg "Math.random" src/export` → no matches; all seeds from `variantSeed` pure hash.
- C10: `vitest run` → Tests 71 passed (71) — 62 pre-existing + 9 new batch tests.
- Variations genuinely differ: 3 distinct PNG md5s across v01–v03.
