# WebGPU day-one check (Task 22, 2026-11-01)

Setup: dev server with the fixture snapshot (`scripts/fixture-snapshot.ts`), Playwright Chromium headless shell 156.

| Run | navigator.gpu | requestAdapter() | Embedding Atlas result |
|---|---|---|---|
| headless shell, `--enable-unsafe-webgpu --use-angle=swiftshader` | present | adapter returned | still "WebGPU is unavailable. This view requires a browser with WebGPU support." (its check also requires `wgslLanguageFeatures`) |
| headless shell, `--disable-features=WebGPU` | present | null | same message + console "Could not request WebGPU adapter / device" |

Findings:
1. `embedding-atlas` 0.26 has **no WebGL path** (no `webgl` strings in `dist/`; it gates on `navigator.gpu.requestAdapter` + `wgslLanguageFeatures`). Without a usable adapter it renders a message, not a map.
2. A presence check on `navigator.gpu` is insufficient: the object exists in environments with no adapter. The app's check must probe `requestAdapter()` asynchronously.
3. Consequence: Task 27B (deck.gl WebGL2 fallback) is required, and the WebGPU probe becomes async.

Addendum (full Chromium 156, new headless, same flags): adapter present but "WebGPU adapter does not support required features: shader-f16" → Embedding Atlas still does not render. Conclusion for CI: the Playwright smoke test cannot exercise the WebGPU renderer on a headless Linux runner; it exercises the deck.gl WebGL2 fallback instead, and the WebGPU path is verified manually in a desktop browser.

## Decision 2026-11-01 (after live testing by the owner)

Embedding Atlas on the owner's WebGPU browser ran at ~1 fps even after removing all per-frame prop churn, and the owner asked for an approach that does not rely on WebGPU and runs well on many devices. The renderer was replaced by a plain **Canvas 2D engine** (`app/canvas/render/*`, `app/canvas/Canvas2D.tsx`) that reproduces the density-terrain look: a kernel-density grid with per-cell dominant cluster, contour bands and marching-squares contour lines in cluster colours baked once into a 2048-px raster; batched point paths; collision-placed hierarchical labels; DOM cards at close zoom; scale bar and point count. `embedding-atlas` and `deck.gl` were removed. No GPU API is used anywhere.


## 2026-11-01, later: Canvas 2D replaced by a retained WebGL2 renderer

The Canvas 2D engine lagged once terrain fills were rasterised per zoom on the CPU. It was replaced by a thin custom WebGL2 engine (`app/canvas/gl/*`) with vector terrain built in a Web Worker (`app/canvas/terrain/*`). Design: `docs/superpowers/specs/2026-11-01-rendering-overhaul-design.md`; research: `~/x-nalenz-data/research_notes/rendering-overhaul-{stack,terrain}.md`.
