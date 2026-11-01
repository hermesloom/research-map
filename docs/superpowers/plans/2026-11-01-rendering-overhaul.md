# Rendering Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, chosen by the owner for this project). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Canvas 2D raster map with a retained WebGL2 renderer: vector terrain meshes built in a Web Worker, instanced points with GPU tweens, anti-aliased instanced contour lines, and one Canvas 2D overlay for labels, identical in look and behaviour across all three lenses.

**Architecture:** `terrain/*` (pure TS, Worker) turns visible lens positions into a `TerrainMesh`; `gl/*` uploads meshes once and draws ≤ 7 calls per frame; `gl/overlay.ts` places and fades labels with hysteresis; `MapView.tsx` is the React shell; `Canvas.tsx` keeps owning state and lenses.

**Tech Stack:** TypeScript strict, WebGL2 (raw), d3-contour 4.0.2, d3-array 3.2.4, earcut 3.2.4, simplify-js 1.2.4, Vitest (Node), Playwright (SwiftShader).

**Spec:** `docs/superpowers/specs/2026-11-01-rendering-overhaul-design.md`

## Global Constraints

- No WebGPU, no MSAA (`antialias: false`), no rendering framework; the only new runtime deps are the four above.
- No CPU rasterisation or tessellation on interaction frames; nothing allocates per frame except the label pass.
- Visual contract in spec §3 is binding (band fractions, alphas, line widths, point radius, colours, label tiers `[0, 40, 100]` px room).
- Same code path for all three lenses; no per-item "new/provisional" styling.
- The existing `camera.ts` conventions stay: camera `{x, y, scale}` in data units, y up, `fitCamera`, `clampScale` (0.25×–80× of fit).
- Tests: every module in `terrain/` and the label/hysteresis logic has Node unit tests; GL correctness is covered by Playwright.
- Commit after every task; keep `pnpm typecheck`, `pnpm test` and `pnpm build` green.

## Review Focus

1. A category whose points are collinear or coincident (sub-grid degenerate, earcut on a sliver) must not throw and must not emit NaN vertices. (Task 5 test `degenerate categories`.)
2. Visible-row changes mid-tween (relevance slider while animating) must snap without a buffer-length mismatch. (Task 8 test in `gl-engine-state.test.ts`.)
3. Label hysteresis must not keep a label alive after its row is filtered out or its tier drops below threshold. (Task 7 tests.)
4. Context loss and StrictMode double-mount must leave no leaked programs or dangling rAF loops. (Task 8 destroy test + e2e console check.)
5. Terrain requests for a superseded key must never upload after a newer one resolved. (Task 6 service test `supersede`.)

---

### Task 1: Terrain types, KDE and bandwidth rule

**Files:**
- Create: `app/canvas/terrain/types.ts`, `app/canvas/terrain/kde.ts`
- Test: `tests/unit/terrain-kde.test.ts`

**Interfaces (Produces):**
```ts
// types.ts
export type RGB = [number, number, number];
export type TerrainInput = { x: Float32Array; y: Float32Array; cat: Uint16Array; catRGB: RGB[]; sigmaUnits?: number; levels?: number[] };
export type TerrainMesh = { positions: Float32Array; colors: Uint8Array; indices: Uint32Array; triCount: number; lines: Float32Array; lineColors: Uint8Array; lineWidths: Float32Array; segmentCount: number; stats: { categories: number; triangles: number; segments: number; ms: number; sigmaUnits: number } };
export const LEVELS = [0.10, 0.25, 0.40, 0.55, 0.70, 0.85];
export const BAND_ALPHA = (b: number) => 0.10 + 0.075 * b;           // b = 1..6
export const SIGMA_CELLS = 16;
// kde.ts
export function medianNN(x: ArrayLike<number>, y: ArrayLike<number>, sample?: number): number;
export function chooseSigma(x: ArrayLike<number>, y: ArrayLike<number>): number;    // clamp(2.5·medianNN, 0.02·extent, 0.08·extent)
export type Field = { values: Float32Array; n: number; m: number; ox: number; oy: number; peak: number };  // sub-grid origin in cells
export function densityField(px: number[], py: number[], cellsPerUnit: number, sigmaCells: number): Field;   // px/py in data units → splat + blur2
```
- [ ] Write tests: `medianNN` of a unit grid is 1; `chooseSigma` clamps; `densityField` mass ≈ point count (sum of values), peak at the point, σ check: value at distance σ ≈ peak·e^(−0.5) within 15 %.
- [ ] Run: `pnpm vitest run tests/unit/terrain-kde.test.ts` → FAIL (module missing).
- [ ] Implement; d3-array `blur2({data, width, height}, r)` with `r = (Math.sqrt(4·σ² + 1) − 1) / 2`; padding `ceil(3σ)` cells.
- [ ] Run → PASS. Commit `feat(terrain): KDE field and bandwidth rule`.

### Task 2: Isolines → nested isobands

**Files:** Create `app/canvas/terrain/isobands.ts`; Test `tests/unit/terrain-isobands.test.ts`

**Interfaces:**
```ts
export type Ring = [number, number][];                     // closed (first == last), sub-grid cell coordinates
export type BandPolygon = { outer: Ring; holes: Ring[]; band: number };   // band 1..6
export function isolines(field: Field, levelsAbs: number[]): Ring[][][];  // per level: polygons [outer, ...holes]
export function isobands(perLevel: Ring[][][], minAreaCells?: number): BandPolygon[];
export function ringArea(r: Ring): number; export function pointInRing(p: [number, number], r: Ring): boolean;
```
- [ ] Tests: single Gaussian field → 6 levels nested; band 1 has exactly one hole (level 2's outer); innermost band has no holes; `ringArea` sign convention documented by test; tiny polygons dropped.
- [ ] Run → FAIL. Implement with `contours().size([n, m]).smooth(true).contour(values, level)`; holes = d3's own holes + exteriors of level i+1 whose first vertex is inside the outer.
- [ ] Run → PASS. Commit `feat(terrain): nested isobands from d3 isolines`.

### Task 3: Ring smoothing

**Files:** Create `app/canvas/terrain/smooth.ts`; Test `tests/unit/terrain-smooth.test.ts`

**Interfaces:**
```ts
export function simplifyRing(r: Ring, tol: number): Ring;        // simplify-js (highQuality), keeps closure, ≥ 4 points or returns input
export function chaikin(r: Ring, iterations: number): Ring;      // closed; each pass maps k edges → 2k points
export function smoothRing(r: Ring): Ring;                       // simplify 0.5 → chaikin 2 → simplify 0.25
```
- [ ] Tests: closure preserved; chaikin doubles vertex count per pass; a square after `smoothRing` has rounded corners (no vertex at the original corner) and area within 15 % of the original; a 3-point degenerate ring returns unchanged.
- [ ] Run → FAIL; implement; → PASS. Commit.

### Task 4: Mesh building (earcut) and line segments

**Files:** Create `app/canvas/terrain/mesh.ts`; Test `tests/unit/terrain-mesh.test.ts`

**Interfaces:**
```ts
export type MeshAccumulator = { positions: number[]; colors: number[]; indices: number[]; lines: number[]; lineColors: number[]; lineWidths: number[] };
export function newAccumulator(): MeshAccumulator;
export function appendBand(acc: MeshAccumulator, poly: BandPolygon, toData: (p: [number, number]) => [number, number], rgb: RGB): void;   // earcut, premultiplied vertex colour at BAND_ALPHA(poly.band)
export function appendRingLines(acc: MeshAccumulator, ring: Ring, toData: ..., rgb: RGB, outer: boolean): void;   // width 1.6/alpha 0.95 if outer else 1/0.6
export function finalize(acc: MeshAccumulator, stats: ...): TerrainMesh;
```
- [ ] Tests: square with square hole → 8 triangles, all indices < vertex count, no triangle spans the hole centre (point-in-triangle check); colours premultiplied (`r' = round(r·a)`, `a' = round(255·a)`); segment count = ring edges; widths/alphas per spec.
- [ ] Run → FAIL; implement; → PASS. Commit.

### Task 5: `buildTerrain` orchestration + worker

**Files:** Create `app/canvas/terrain/build.ts`, `app/canvas/terrain/worker.ts`; Test `tests/unit/terrain-build.test.ts`

**Interfaces:**
```ts
export function buildTerrain(input: TerrainInput): TerrainMesh;      // deterministic; categories with < 3 points and category 0 skipped
export function transferables(m: TerrainMesh): ArrayBuffer[];
// worker.ts: onmessage({ id, input }) → postMessage({ id, mesh }, transferables(mesh)); errors → postMessage({ id, error })
```
- [ ] Tests: two well-separated Gaussian clusters (300 pts each) → `stats.categories === 2`, triangles > 0, segments > 0, every position finite, every index < positions.length/2; identical input twice → byte-identical output; empty input → empty mesh; `degenerate categories` (3 coincident points, 4 collinear points) → no throw, finite output; soft timing: 1,300 points / 50 categories < 1,500 ms (log, assert < 5,000).
- [ ] Run → FAIL; implement (per-category loop: field → levels `LEVELS.map(f => f·peak)` → isolines → isobands → smooth each distinct ring once (Map by reference) → appendBand/appendRingLines; outer = band 1 outer rings).
- [ ] Run → PASS. Commit.

### Task 6: TerrainService (cache, dedupe, supersede, main-thread fallback)

**Files:** Create `app/canvas/gl/terrainService.ts`; Test `tests/unit/terrain-service.test.ts`

**Interfaces:**
```ts
export type TerrainKey = string; export function terrainKey(lens: string, rows: ArrayLike<number>): TerrainKey;   // FNV-1a over rows
export class TerrainService {
  constructor(opts: { workerFactory?: () => Worker | null; buildInline?: (i: TerrainInput) => TerrainMesh; maxCached?: number });
  request(key: TerrainKey, input: TerrainInput, cb: (key: TerrainKey, mesh: TerrainMesh) => void): void;   // cached → sync cb; in-flight same key → joins; new key → supersedes older pending callbacks for other keys (they are dropped)
  cancelAll(): void; dispose(): void;
}
```
- [ ] Tests with a fake worker (controllable `postMessage`/`onmessage`): cache hit is synchronous; two requests same key → one build; `supersede`: request A then B before A resolves → A's callback never fires, B's does; LRU evicts beyond `maxCached`; no worker → inline build via `buildInline` and callback still async (microtask).
- [ ] Run → FAIL; implement; → PASS. Commit.

### Task 7: Label overlay logic with hysteresis and fades

**Files:** Modify `app/canvas/render/labels.ts` (keep `placeLabels`, `labelSpacingPx`, `levelVisible`); Create `app/canvas/gl/overlay.ts`; Test `tests/unit/label-hysteresis.test.ts`

**Interfaces:**
```ts
// labels.ts additions
export const PLACEMENT_PAD_PX = 100; export const INCUMBENT_BONUS = 1e6;
export function placeLabels(labels: LabelIn[], cam, vp, measure, spacingPx, max = 400, incumbents?: Set<string>): PlacedLabel[];   // key = `${level}|${text}|${x.toFixed(4)}|${y.toFixed(4)}`; incumbents sorted first within their tier; pad = PLACEMENT_PAD_PX
export type LabelState = { key: string; box: PlacedLabel; opacity: number; target: 0 | 1 };
export class LabelFader { step(placed: PlacedLabel[], now: number): LabelState[]; }   // 150 ms linear fades; removed labels fade out then drop
// overlay.ts: class Overlay { constructor(canvas: HTMLCanvasElement); resize(w,h,dpr); setLabels(l: LabelIn[]); draw(cam, vp, spacingPx, anchors: (l: LabelIn) => {x,y}, extras: { pointCount: number; notice?: string }, now: number): boolean /* needs another frame */; }
```
- [ ] Tests: incumbents win ties against equal-priority newcomers; a label outside the 100 px pad is excluded; `LabelFader` ramps 0→1 over 150 ms and drops a label 150 ms after it disappears; a label whose tier is no longer visible gets target 0 immediately; placement is not re-run when `needsPlacement(cameraChanged, inputsChanged, settled, sinceLast)` says so (pure function tested: moving → ≥ 120 ms gap; settled → immediate once).
- [ ] Run → FAIL; implement; → PASS. Commit.

### Task 8: WebGL2 engine (context, passes, tween, picking, interaction)

**Files:** Create `app/canvas/gl/{context,shaders,terrainPass,linePass,pointPass,interaction,engine}.ts`; Test `tests/unit/gl-engine-state.test.ts` (pure state helpers: `tweenState`, `retargetMidTween`, `pickNearest`), `tests/unit/interaction.test.ts` (wheel/drag/pinch → camera with a fake element)

**Interfaces:**
```ts
export type EngineData = { x: Float32Array; y: Float32Array; rgba: Uint8Array; cat: Uint16Array; catRGB: RGB[] };
export class MapEngine {
  constructor(glCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement, opts: { onCamera?: (c: Camera) => void; onPick?: (row: number) => void; terrain?: TerrainService });
  readonly mode: "webgl2" | "overlay-only"; get camera(): Camera;
  resize(w: number, h: number, dpr: number): void;
  setData(d: EngineData, initialCamera?: Camera | null): void;                    // snaps; refits on first data
  setTarget(x: Float32Array, y: Float32Array, opts: { refit?: boolean; fitFill?: number; fitAnchors?: {x:number;y:number}[] }): void;   // 600 ms GPU tween
  setTerrainKey(key: string, input: TerrainInput): void;                        // asks the service; crossfades on arrival
  setLabels(l: LabelIn[]): void; setSelected(row: number): void; setCamera(c: Camera): void; flyTo(x, y, scale?): void; fit(): void;
  stats(): { drawCalls: number; frameMs: number[]; gpuMs?: number; mode: string; terrain: TerrainMesh["stats"] | null };
  readPixel(x: number, y: number): [number, number, number, number];           // test hook: draws then reads
  destroy(): void;
}
```
Shaders (GLSL ES 3.00):
- terrain: `in vec2 a_pos; in vec4 a_rgba; uniform vec4 u_view; uniform float u_alpha; out vec4 v_c; gl_Position = vec4((a_pos - u_view.xy) * u_view.zw, 0, 1); v_c = a_rgba * u_alpha;` fragment `o = v_c;`
- line: unit quad `(0/1, ±1)`; per-instance `a_a, a_b, a_rgba, a_w`; screen-space normal; half width `max(a_w·dpr, 1)/2 + 1` device px; `v_dist` across; fragment Mapbox ramp with `blur = 0.5` device px; alpha folded when `a_w·dpr < 1`.
- point: unit quad `(±1, ±1)`; `pos = mix(a_from, a_to, u_t)`; `v_uv`; fragment `d = length(v_uv); a = 1 - smoothstep(1 - fw, 1, d)` (disc) or annulus when `u_ring == 1` (inner = 1 − 2/r).
- [ ] Tests (state helpers, no GL): `tweenState` eased t; `retargetMidTween` mixes from/to into new from; `pickNearest` picks within 12 px using mixed positions; interaction maps wheel deltaY → `exp(-deltaY·0.0015)`, drag → pan, two pointers → pinch zoom at midpoint, click (no move > 3 px) → pick.
- [ ] Run → FAIL; implement everything in this task; `pnpm typecheck`; → PASS. Commit.

### Task 9: MapView + Canvas integration, delete old engine

**Files:** Create `app/canvas/MapView.tsx`; Modify `app/canvas/Canvas.tsx`, `app/canvas/lenses.ts` (`lensAnchors(lens, …)` for fit), `app/canvas/render/camera.ts` (`fitCameraTo(points, anchors, vp, fill)`), `app/canvas/overlayLogic.ts` (remove `newestRows`, `cardHtml`); Delete `app/canvas/render/{engine,contours,density}.ts`, `app/canvas/Canvas2D.tsx`, `tests/unit/{contours,density}.test.ts`; move `medianSpacing` → `terrain/kde.ts` (`medianNN`).
- [ ] Tests: `camera.test.ts` gains `fitCameraTo` including anchors; `overlayLogic.test.ts` updated; `tests/unit/colors.test.ts` gains `rgbaForRows` (Uint8 RGBA from palette+grade).
- [ ] Wire: `Canvas.tsx` builds `EngineData { x, y, rgba, cat, catRGB }`, passes `terrainKey(lens, idx)` + `TerrainInput`, `labels`, `fitAnchors`.
- [ ] `pnpm typecheck && pnpm test && pnpm build` green. Commit `feat(canvas): WebGL2 map engine replaces the Canvas 2D raster renderer`.

### Task 10: e2e + perf + visual check

**Files:** Create `tests/e2e/render.spec.ts`, `tests/e2e/lenses.spec.ts`, `tests/e2e/perf.spec.ts`; Modify `tests/e2e/click.spec.ts` (uses `__map.readPixel`/camera).
- [ ] `render.spec`: no console errors; `window.__map.stats().mode === "webgl2"`; after terrain arrives (`stats().terrain`), `readPixel` at a cluster centre is not background and at a far corner is background; draw calls ≤ 7.
- [ ] `lenses.spec`: switching lens yields terrain in each lens (stats.terrain.categories > 0) and title labels at the same room threshold (zoom to spacing 120 px in each lens → overlay has ≥ 1 title label; the overlay exposes `__map.labels()` for the test); relevance `g=3` removes titles of hidden rows.
- [ ] `perf.spec`: scripted wheel zoom + drag for 3 s; `stats().frameMs` median ≤ 8 ms (SwiftShader CPU) and no frame > 100 ms after the first terrain upload.
- [ ] Screenshots of the three lenses at fit / 3× / 10× saved to the scratchpad and inspected; compare against the spec's visual contract.
- [ ] Update `docs/superpowers/plans/notes-webgpu.md` with a pointer to the new design; append ledger. Commit, push `build/v1`, fast-forward `main`.
