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
