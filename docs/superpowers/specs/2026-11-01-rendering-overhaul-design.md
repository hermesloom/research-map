# Rendering overhaul: retained WebGL2 map renderer

Date: 2026-11-01. Status: approved for implementation by the owner's instruction ("a top notch canonical overhaul of the entire existing rendering system"). Supersedes the rendering sections of `2026-11-01-research-map-design.md`. Research behind every decision: `~/x-nalenz-data/research_notes/rendering-overhaul-stack.md` and `rendering-overhaul-terrain.md`.

## 1. Problem

The map is drawn with Canvas 2D. Terrain fills are rasterised on the CPU (a per-pixel JS loop over the viewport on every zoom step) and contour lines are stroked per frame. On the owner's machine this lags badly; Embedding Atlas (WebGPU) before it ran at ~1 fps. The owner's requirements, verbatim where it matters:

- "it should look great on many devices and not rely on WebGPU at all"; "buttery smooth 60fps".
- "ensure that visually it'll be identical to what we had so far" (concentric density bands per cluster with contour lines, points, hierarchical labels).
- "it's just nodes and the terrain, both are clearly vector graphics" — crisp at every zoom.
- "there should not be different ways of rendering": terrain, points and labels behave the same in all three lenses.
- "I don't like that the new nodes are rendered in any way differently than the rest."
- "the labels should be consistent across ALL the lenses and come into view on the same level of zoom"; only displayed nodes get labels.
- Clicking a node shows the original X post (done, stays).

## 2. Decision

One renderer: a thin custom **WebGL2** engine (raw WebGL2, no framework) drawing retained GPU geometry, plus one transparent **Canvas 2D overlay** for text (labels, scale bar, counter). No per-frame tessellation, no CPU rasterisation, no MSAA, no WebGPU.

Why not a library: deck.gl tessellates polygons on the main thread and its collision-filtered text has open correctness bugs at our usage pattern; PixiJS needs custom shaders for the same three hard parts (constant-width AA lines, hole-safe fills, fill-edge AA) and adds 120–240 kB; MapLibre has no per-feature position transitions; Canvas 2D vector fills re-triangulate on zoom. The hard project-specific parts (camera, interaction, hierarchical label placement, lens tween) already exist in TypeScript and are renderer-agnostic.

Why terrain geometry is vector: per-category KDE → isobands → triangles, built once per (lens, visible set) in a Web Worker in ~0.3–0.5 s, drawn as one static vertex buffer. Crisp at any zoom, ~18k triangles, one draw call.

## 3. Visual contract (what "identical" means)

| Element | Rule |
| --- | --- |
| Background | `#0b0d10`. |
| Terrain bands | A vector **tiling** of the total density: six levels chosen by enclosed mass (highest-density regions `[0.94, 0.86, 0.74, 0.58, 0.38, 0.15]`, which for a Gaussian blob equal the classic fraction-of-peak levels `[0.06 … 0.85]` the accepted raster renderer used), each level region split along the curves where one cluster category's density overtakes every other's (region (c, L) = {total ≥ L} ∩ {f_c > max others}, traced as the zero isoline of min(total − L, f_c − other), so neighbouring regions share identical boundaries). Unclustered category 0 has no terrain. Level regions are stacked (level ≥ b drawn over level ≥ b−1) with incremental alphas so the visible alpha at band b is exactly `0.10 + 0.075·b` (0.175 … 0.55) in the category colour; regions never overlap across categories. *Decided during implementation:* per-category isobands with holes produced overlapping mud where categories interleave (time lens) and earcut slivers where a hole crossed its outer ring; the tiling with stacked regions has neither problem. |
| Contour lines | Every band boundary stroked in the category colour: outermost ring 1.6 px at alpha 0.95, inner rings 1 px at alpha 0.6. Pixel-constant width at every zoom, analytic anti-aliasing (half-device-pixel feather). |
| Terrain per lens | Topic terrain and "Around the question" show terrain; "Time strata" shows none (owner decision 2026-11-01: months and rows already structure that view, and every topic spans the whole axis). |
| Terrain visibility | Alpha 1 while the room per visible point (§5) is ≤ 160 px, fading linearly to 0.35 at ≥ 400 px. Same rule in every lens. |
| Points | Discs, radius `min(7, 3 + 0.8·log2(max(1, zoomRel)))` CSS px where zoomRel is zoom relative to the fitted view; colour = leaf palette with grade alpha `[0.18, 0.45, 0.85, 1.0]` (ungraded displays as grade 1; unclustered grey `#cfcfcf`). SDF disc with 1 px feather. No halos, rings, trails or any marking for new or provisional posts by default. *Added 2026-11-02 (owner request):* an opt-in header checkbox "highlight recent" (`?recent=1`, off by default) rings the 20 newest displayed posts in amber `#ffd166`, 2 px, radius `r + 5`, opacity stepping from 1.0 for the newest down by 0.05 per post to 0.05 for the 20th. Rings re-use the point tween, so they move with the lens; same rule in every lens. |
| Selection | One ring, `#9cc4ff`, 2 px, radius `r + 9`. |
| Labels | Three tiers: themes (20 px, weight 600), cluster labels (13 px), post titles (11 px, left of anchor + 8 px). Dark halo (`rgba(11,13,16,0.85)`, 5 px for themes, 3 px otherwise). Greedy collision placement by tier then priority, max 400. Titles exist only for displayed (filtered-in) rows, in every lens. |
| Lens transitions | Points move along a 600 ms ease-in-out-cubic tween on the GPU. Outgoing terrain fades out and incoming terrain fades in over the same 600 ms. Labels follow the tweened anchors. |
| Status | Scale bar and "N points" bottom right, as today. |

## 4. Architecture

```
Canvas.tsx (state: snapshot, lens, filters, URL)          unchanged responsibilities
   │ props: data{x,y,rgba,cat}, target{x,y}, lens, labels, selectedRow, camera callbacks
   ▼
MapView.tsx (React shell)  ── creates ──▶ MapEngine (app/canvas/gl/engine.ts)
                                            ├─ Camera + interaction  (render/camera.ts, gl/interaction.ts)
                                            ├─ GL context + programs (gl/context.ts, gl/shaders.ts)
                                            ├─ TerrainPass  (static VBO/IBO per terrain mesh, crossfade)
                                            ├─ LinePass     (instanced AA segments)
                                            ├─ PointPass    (instanced SDF discs, GPU tween, selection ring)
                                            ├─ Overlay      (Canvas 2D: labels w/ hysteresis, scale bar)
                                            └─ TerrainService (gl/terrainService.ts) ──▶ Web Worker
                                                                                   terrain/worker.ts → terrain/build.ts
                                                                                   (kde.ts, isobands.ts, smooth.ts, mesh.ts)
```

### 4.1 Terrain generation (`app/canvas/terrain/*`, pure TypeScript, runs in a Worker, unit-tested in Node)

Input: `x, y: Float32Array` (visible rows of the active lens), `cat: Uint16Array` (0 = unclustered), `catRGB: [r,g,b][]`, options `{ sigmaUnits?, levels? }`.

1. **Bandwidth.** `sigma = clamp(2.5 · medianNN(x, y), 0.005·extent, 0.08·extent)` in data units, where `medianNN` is the median nearest-neighbour spacing of all input points (sampled) and `extent` is the larger side of the bounding box (the floor is only a guard against coincident points, so anisotropic layouts such as the time lens are not inflated by their width). Grid resolution `cellsPerUnit = 12 / sigma` (σ = 12 cells), coarsened if the global grid would exceed 600k cells.
2. **Pass 1, per category with ≥ 3 points:** sub-grid = category bbox padded by 3σ; bilinear splat; Gaussian via `d3-array blur2` with radius `r = (sqrt(4σ² + 1) − 1) / 2`; accumulate the total density and the two strongest categories per global cell.
3. **Levels:** `hdrLevels(total, MASS_LEVELS)`: density thresholds above which the cells hold the given fraction of the total mass (estimated on a stride sample).
4. **Pass 2, per category:** recompute its field; crop to the bounding window of the cells it dominates (+2 cells); for each level build `m = min(total − L, f_c − strongestOther)` and trace `contours().contour(m, 0)`; stop at the first empty level. Skip polygons with area < 4 cells².
5. **Smoothing (each distinct ring once):** Chaikin ×2 → Douglas–Peucker 0.15 cells (corner cutting keeps a simple ring simple; no pre-simplification, which could introduce self-intersections), then convert to data units.
6. **Mesh:** earcut per level region (its own holes via start indices), vertex alpha = `BAND_ALPHA_INCREMENT(b)`. Output `TerrainMesh`:
   - `positions: Float32Array` (x, y pairs, data units), `colors: Uint8Array` (premultiplied RGBA per vertex), `indices: Uint32Array`, `triCount`,
   - `lines: Float32Array` of segments `(ax, ay, bx, by)`, `lineColors: Uint8Array` (RGBA per segment), `lineWidths: Float32Array` (CSS px),
   - `stats: { categories, triangles, segments, ms }`.
   All typed arrays are transferred, not copied.
7. Determinism: same input → identical output (no randomness), so caches are valid.

Measured on the real map (1,232 posts, 40 clusters): terrain lens ≈ 9.5k triangles / 10k segments, 0.4 s warm in Node, ≈ 1 s cold in the browser worker; question lens ≈ 1.6 s; time lens ≈ 2.7 s (every cluster spans the whole time axis). All off the main thread, cached per (lens, rows, positions).

### 4.2 TerrainService (`gl/terrainService.ts`)

- Key = `${lens}|${hash(visible row indices)}`. LRU cache of 6 meshes. In-flight requests are deduplicated; a newer request supersedes an older one for the same key.
- Falls back to running `buildTerrain` on the main thread, chunked by category via `setTimeout(0)`, when `Worker` is unavailable (tests, very old browsers).
- Emits `(key, mesh)`; the engine uploads buffers and starts a crossfade.

### 4.3 GL engine (`gl/engine.ts`)

- Context: `getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" })`. Drawing buffer at `min(devicePixelRatio, 2)`. Blend `ONE, ONE_MINUS_SRC_ALPHA`.
- Uniform per frame: `u_view = (cx, cy, scaleX, scaleY)` mapping data → clip space; `u_dpr`, `u_t` (tween progress, eased), `u_alpha` per pass.
- Draw order per frame: clear; terrain A (fading out) and terrain B (fading in) fills; their lines; points; selection ring. Then the overlay canvas draws labels and the status bar (only when its inputs changed: camera, labels, placement result, point count).
- **TerrainPass:** `positions` + `colors` interleaved in one VBO, `indices` in an IBO (`OES_element_index_uint` is core in WebGL2). Fragment colour = vertex colour × `u_alpha`.
- **LinePass:** instanced unit quad; per-instance `a_a (vec2), a_b (vec2), a_rgba (u8x4 normalised), a_width (float)`. Vertex shader extrudes in screen space by `width/2 + 1 px` of feather; fragment applies the Mapbox ramp `alpha = clamp(min(d − (inner − blur), outer − d) / blur, 0, 1)` with `blur = 1/dpr/2`. Width below 1 device px is clamped to 1 and the remainder folded into alpha.
- **PointPass:** instanced unit quad; per-instance `a_from (vec2), a_to (vec2), a_rgba (u8x4)`. `pos = mix(a_from, a_to, u_t)`. Fragment: SDF disc with `fwidth` feather. Radius from `u_radius`. Selection ring = second draw of one instance with `u_ring = 1` (annulus SDF).
- **Tween:** `setTarget(x, y)` uploads the new `a_to` and copies the previous display positions into `a_from`; `u_t` runs 0→1 over 600 ms with ease-in-out-cubic. Mid-tween retarget: `a_from` ← current mixed positions (computed on the CPU once, 5k points), `t` restarts. Row count changes (filter) replace both buffers and snap.
- **Picking:** CPU nearest row within 12 px using the current (mixed) positions; computed only on click.
- **Resize/DPR:** drawing buffer resized on ResizeObserver and DPR change; overlay canvas at full DPR.
- **Context loss:** `webglcontextlost` → `preventDefault`, pause; `webglcontextrestored` → recreate programs and re-upload every buffer from the retained CPU-side copies. If WebGL2 is unavailable at start, the engine runs in **overlay-only mode**: points (batched Path2D by colour) and labels on the overlay, no terrain, and a one-line notice in the status bar ("terrain needs WebGL2"). This is the only fallback; the old raster engine is deleted.
- **StrictMode:** `destroy()` releases buffers/programs and calls `WEBGL_lose_context.loseContext()`.

### 4.4 Labels (`render/labels.ts` + `gl/overlay.ts`)

- Inputs (per lens, from `lensLabels`): structural labels (theme/cluster labels on the terrain lens; the core question and ring labels on the question lens; row labels on the time lens) plus post titles for the visible rows, anchored at the row's current lens position.
- Tier visibility by **room per visible point** `s = sqrt(viewport area / points in view)` (CSS px): themes always, cluster labels at `s ≥ 40`, titles at `s ≥ 100`. Identical in all lenses.
- Placement runs when the camera or inputs changed and at most every 120 ms while moving; immediately when the camera settles. Incumbents (labels placed in the previous pass) get a priority bonus so labels do not flicker; the collision region is padded by 100 px beyond the viewport; each label fades in/out over 150 ms (opacity stepped per frame).
- `measureText` cached per (font size, text). Text drawn with `fillText` over a `strokeText` halo.
- During a lens tween, title anchors are the mixed positions (computed on the CPU for the ≤ 400 candidate rows per placement pass, not for all points).
- Camera fit for a lens includes the anchors of its structural labels (so time-lens row labels are inside the view).

### 4.5 Data flow changes

- `EngineData` becomes `{ x, y, rgba: Uint8Array (4 per row), cat: Uint16Array, catRGB: [r,g,b][] }`. `provisional`, `newest`, `color: string[]` are removed. `newestRows` and `cardHtml` are deleted from `overlayLogic.ts`.
- `Canvas.tsx` passes `lens`, `idx` (visible rows) and `target` as today; `MapView` asks the TerrainService for `(lens, idx)`.
- Nothing changes in the pipeline, the batch job, the snapshot format or the APIs.

## 5. Performance targets and how they are measured

| Metric | Target | Measured by |
| --- | --- | --- |
| GL draw calls per frame | ≤ 7 | code inspection + e2e counter hook |
| Main-thread JS per frame while panning/zooming (no placement pass) | ≤ 1.5 ms median (desktop Chrome) | `tests/e2e/perf.spec.ts` + `window.__map.stats()` |
| Label placement pass | ≤ 4 ms at 1,500 candidates | unit benchmark in Vitest (soft assert) |
| Terrain build (worker) | ≤ 1.5 s cold for 1,300 points / 50 categories in Node | unit test timing (soft assert) |
| Frame budget on Adreno-618 / Intel UHD 620 class | ≤ 6 ms GPU [estimate from research memo] | owner's device; `EXT_disjoint_timer_query_webgl2` stats exposed on `__map.stats()` when available |
| Bundle | no rendering framework; new deps: `d3-contour`, `d3-array`, `earcut`, `simplify-js` (~25 kB gz total) | build output |

Headless Chromium uses SwiftShader (software GL), so e2e checks correctness and main-thread cost, not GPU time.

## 6. Testing

- **Unit (Node):** `kde` (splat mass, blur σ, bandwidth rule), `isobands` (nesting → holes, hole count, area filter), `smooth` (Chaikin vertex count, DP tolerance, closure), `mesh` (earcut index validity, premultiplied colours, segment count), `build` (determinism, categories < 3 points skipped, empty input), `terrainService` (cache, dedupe, supersede, main-thread fallback), `labels` (tier rule, hysteresis, padding, fade state machine), `interaction` (wheel/drag/pinch → camera), `camera` (fit includes label anchors).
- **e2e (Playwright, SwiftShader):** page renders without console errors; `__map.readPixel` finds a terrain colour inside a cluster and background outside; click opens the inspector; lens switch animates (positions differ at t=0.3 and t=1); terrain appears in all three lenses; title labels appear at the same room-per-point threshold in all three lenses; relevance filter removes titles of hidden rows; perf spec asserts median JS frame time.
- Visual check: screenshots of the three lenses at fit, 3×, 10× compared by eye against the current build before merge.

## 7. Out of scope

GPU text (SDF atlas) — only if the overlay measures > 3 ms on the owner's phone. Light theme. Precomputing terrain in the batch job (the worker is fast enough; revisit if first paint on phones exceeds 2 s). deck.gl fallback (documented in the research memo, not built).

## 8. Files

Create: `app/canvas/terrain/{kde,isobands,smooth,mesh,build,worker,types}.ts`, `app/canvas/gl/{context,shaders,terrainPass,linePass,pointPass,overlay,interaction,terrainService,engine}.ts`, `app/canvas/MapView.tsx`, tests under `tests/unit/terrain-*.test.ts`, `tests/unit/gl-*.test.ts`, `tests/e2e/{render,lenses,perf}.spec.ts`.
Modify: `app/canvas/Canvas.tsx`, `app/canvas/render/labels.ts`, `app/canvas/render/camera.ts`, `app/canvas/lenses.ts`, `app/canvas/overlayLogic.ts`, `package.json`.
Delete: `app/canvas/render/{engine,contours,density}.ts`, `app/canvas/Canvas2D.tsx`, `tests/unit/{contours,density}.test.ts`.
