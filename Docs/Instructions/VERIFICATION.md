# Verification recipes

How changes in this repo get verified end-to-end (used by every G-series
commit since G5; keep following it).

## Gates (all must pass before "done")

```powershell
npm test        # vitest, node env — no canvas/GL, pure core + export logic
npm run build   # tsc -b && vite build — type errors surface here, not in dev
npm run lint    # oxlint; scratch-bundle.mjs + SpritesTab warnings are known
```

vitest excludes `.claude/**` (agent worktrees under the repo would otherwise
double-run the suite).

## Visual verification (the part tests can't cover)

Playwright + chromium are dev-dependencies and installed. Serve the built
app, drive the real UI, screenshot, and **look at the PNGs** — WebGL2 (and
the bake pipeline) runs fine in headless chromium via SwiftShader.

```js
// scratch-*.mjs in the repo root (delete before committing)
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:4189/?preset=gargantua'); // ?preset= picks any bundled preset
await page.waitForTimeout(2500);                            // let the bake settle
await page.locator('img.gen-preview').screenshot({ path: 'out.png' }); // workbench sprite
await page.locator('.viewport canvas').screenshot({ path: 'sky.png' }); // live sky
```

- Serve with `npm run preview -- --port 4189 --strictPort` (dist is static —
  a rebuild is picked up without restarting the server).
- Sidebar buttons: `getByRole('button', { name: 'Stars', exact: true })`
  (exact — "+stars" collides), sliders/selects via `getByLabel(...)` in the
  inspector/workbench (controls.tsx wires htmlFor); export-panel checkboxes
  have NO label association — use
  `.locator('.export-panel input[type=checkbox]').nth(i)`
  (order: faces, equirect, hdr, exr, per-layer).
- Downloads: `page.waitForEvent('download')` then `download.saveAs(...)`,
  unzip and probe contents with node.

## Determinism spot-check

Two independent export runs of the same preset/seed must be byte-identical
(`diff -r` on unzipped batches). `rg "Math.random" src` must stay empty —
all randomness flows from MsvcRng / PerlinNoise seeds.

## Gotchas learned the hard way

- Volumetric `powerAmount` is `pow(n, 1.0 / power)` — LOWER values sparsify,
  higher values thicken toward fog (opposite of intuition).
- Black-hole lens captures depend on viewport size; anything that changes
  how the scene renders (resize, async textures) must re-run prepares.
- Additive (one/one) layers ignore texture alpha — sprites for them must be
  flattened onto opaque black (see flattenOntoBlack in genCommon).
