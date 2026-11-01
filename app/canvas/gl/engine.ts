import { project, zoomAt, fitCameraTo, clampScale, type Camera, type Viewport } from "../render/camera";
import { needsPlacement, type LabelIn } from "../render/labels";
import { createGL, type GL } from "./context";
import { Programs, TerrainLayer, PointLayer, type View } from "./passes";
import { Overlay } from "./overlay";
import { Interaction } from "./interaction";
import { TerrainService } from "./terrainService";
import { tweenProgress, mixPositions, pickNearest, pointRadius, terrainAlpha } from "./state";
import type { RGB, TerrainInput, TerrainMesh } from "../terrain/types";

export type EngineData = { x: Float32Array; y: Float32Array; rgba: Uint8Array; cat: Uint16Array; catRGB: RGB[] };
export type EngineOpts = { onCamera?: (c: Camera) => void; onPick?: (row: number) => void; terrain?: TerrainService };
export type EngineStats = { mode: "webgl2" | "overlay-only"; drawCalls: number; frameMs: number[]; terrain: TerrainMesh["stats"] | null; labels: number; points: number; spacingPx: number };
const BG: [number, number, number] = [11 / 255, 13 / 255, 16 / 255];
const CROSSFADE_MS = 600;

/** Retained WebGL2 map: static terrain meshes, instanced points with a GPU tween, instanced AA contour lines, and a Canvas 2D overlay for text. Falls back to overlay-only (points + labels) without WebGL2. */
export class MapEngine {
  readonly mode: "webgl2" | "overlay-only";
  private gl: GL | null = null; private P: Programs | null = null; private points: PointLayer | null = null;
  private layers: { key: string; layer: TerrainLayer | null; mesh: TerrainMesh; t0: number; out: boolean }[] = [];
  private overlay: Overlay; private inter: Interaction; private service: TerrainService;
  private vp: Viewport = { w: 800, h: 600 }; private dpr = 1; private glDpr = 1;
  private cam: Camera = { x: 0, y: 0, scale: 1 }; private fitScale = 0;
  private data: EngineData | null = null; private from: Float32Array | null = null; private to: Float32Array | null = null; private cur: Float32Array | null = null; private curX: Float32Array | null = null; private curY: Float32Array | null = null;
  private tweenT0 = -1; private tweenT = 1;
  private labelsIn: LabelIn[] = []; private labelsDirty = true; private camDirty = true; private lastCamMove = 0; private spacingPx = Infinity;
  private wantedKey: string | null = null; private selected = -1;
  private dirty = true; private overlayDirty = true; private raf = 0; private destroyed = false; private lost = false;
  private drawCalls = 0; private frameMs: number[] = [];

  constructor(private glCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement, private opts: EngineOpts = {}) {
    this.overlay = new Overlay(overlayCanvas); this.service = opts.terrain ?? new TerrainService();
    this.gl = createGL(glCanvas); this.mode = this.gl ? "webgl2" : "overlay-only";
    if (this.gl) { this.initGL(); glCanvas.addEventListener("webglcontextlost", this.onLost); glCanvas.addEventListener("webglcontextrestored", this.onRestored); }
    this.inter = new Interaction(overlayCanvas, {
      pan: (dX, dY) => this.setCamera({ x: this.cam.x - dX / this.cam.scale, y: this.cam.y + dY / this.cam.scale, scale: this.cam.scale }),
      zoomAt: (X, Y, f) => this.setCamera(zoomAt(this.cam, this.vp, X, Y, f)),
      click: (X, Y) => { if (!this.curX || !this.curY) return; this.syncCur(performance.now()); const row = pickNearest(this.curX, this.curY, this.cam, this.vp, X, Y, 12); if (row >= 0) this.opts.onPick?.(row); },
    });
    this.loop();
  }
  private initGL() {
    const gl = this.gl!; this.P = new Programs(gl); this.points = new PointLayer(this.P); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.data) { this.points.setColors(this.data.rgba); if (this.from) this.points.setFrom(this.from); if (this.to) this.points.setTo(this.to); }
    for (const L of this.layers) L.layer = new TerrainLayer(this.P, L.mesh);
    this.dirty = true;
  }
  private onLost = (e: Event) => { e.preventDefault(); this.lost = true; for (const L of this.layers) L.layer = null; this.P = null; this.points = null; };
  private onRestored = () => { this.lost = false; this.initGL(); };

  get camera() { return this.cam; }
  resize(w: number, h: number, dpr: number) {
    this.vp = { w, h }; this.dpr = dpr; this.glDpr = Math.min(dpr, 2);
    this.glCanvas.width = Math.max(1, Math.round(w * this.glDpr)); this.glCanvas.height = Math.max(1, Math.round(h * this.glDpr)); this.glCanvas.style.width = `${w}px`; this.glCanvas.style.height = `${h}px`;
    this.overlay.resize(w, h, dpr); this.dirty = true; this.overlayDirty = true; this.camDirty = true;
  }
  /** New rows (colours and, when the row count changes, positions). Positions are kept when the count matches so a following setTarget can animate. */
  setData(d: EngineData, initialCamera?: Camera | null) {
    const first = !this.data; const n = d.x.length; this.data = d;
    if (!this.from || this.from.length !== n * 2) {
      this.from = PointLayer.interleave(d.x, d.y); this.to = PointLayer.interleave(d.x, d.y); this.cur = new Float32Array(n * 2); this.curX = Float32Array.from(d.x); this.curY = Float32Array.from(d.y); this.tweenT0 = -1; this.tweenT = 1;
      this.points?.setFrom(this.from); this.points?.setTo(this.to);
    }
    this.points?.setColors(d.rgba);
    if (first) { const fit = fitCameraTo(d.x, d.y, [], this.vp, 0.85); this.fitScale = fit.scale; this.setCamera(initialCamera ?? fit); }
    this.labelsDirty = true; this.dirty = true;
  }
  /** Animate every row from where it is now to (x, y) over 600 ms (GPU). */
  setTarget(x: Float32Array, y: Float32Array, opts: { refit?: boolean; fitFill?: number; fitAnchors?: { x: number; y: number }[] } = {}) {
    if (!this.from || !this.to || !this.cur || this.from.length !== x.length * 2) { this.from = PointLayer.interleave(x, y); this.to = PointLayer.interleave(x, y); this.cur = new Float32Array(x.length * 2); this.curX = Float32Array.from(x); this.curY = Float32Array.from(y); this.tweenT0 = -1; this.tweenT = 1; this.points?.setFrom(this.from); this.points?.setTo(this.to); }
    else {
      const now = performance.now(); this.syncCur(now); this.from.set(this.cur); PointLayer.interleave(x, y, this.to); this.tweenT0 = now; this.tweenT = 0;
      this.points?.setFrom(this.from); this.points?.setTo(this.to);
    }
    if (opts.refit) { const fit = fitCameraTo(x, y, opts.fitAnchors ?? [], this.vp, opts.fitFill ?? 0.85); this.fitScale = fit.scale; this.setCamera(fit); }
    this.labelsDirty = true; this.dirty = true;
  }
  /** Ask for the terrain of this key; when it arrives (or is cached) it crossfades in over the current one. */
  setTerrain(key: string, input: TerrainInput) {
    if (this.wantedKey === key) return; this.wantedKey = key;
    if (this.layers.some((L) => L.key === key && !L.out)) return;
    this.service.request(key, input, (k, mesh) => { if (this.destroyed || k !== this.wantedKey) return; this.showTerrain(k, mesh); });
  }
  private showTerrain(key: string, mesh: TerrainMesh) {
    const now = performance.now();
    for (const L of this.layers) if (!L.out) { L.out = true; L.t0 = now; }
    this.layers.push({ key, mesh, layer: this.P ? new TerrainLayer(this.P, mesh) : null, t0: now, out: false }); this.dirty = true;
  }
  setLabels(l: LabelIn[]) { this.labelsIn = l; this.labelsDirty = true; }
  setSelected(row: number) { this.selected = row; this.dirty = true; }
  setCamera(c: Camera) { this.cam = this.fitScale > 0 ? { ...c, scale: clampScale(c.scale, this.fitScale) } : c; this.dirty = true; this.camDirty = true; this.lastCamMove = performance.now(); this.opts.onCamera?.(this.cam); }
  flyTo(x: number, y: number, scale?: number) { this.setCamera({ x, y, scale: scale ?? Math.max(this.cam.scale, this.fitScale * 10) }); }
  fit() { if (this.curX && this.curY) this.setCamera(fitCameraTo(this.curX, this.curY, [], this.vp, 0.85)); }
  stats(): EngineStats { const cur = this.layers.find((L) => !L.out); return { mode: this.mode, drawCalls: this.drawCalls, frameMs: this.frameMs.slice(), terrain: cur ? cur.mesh.stats : null, labels: this.overlay.labels().length, points: this.curX?.length ?? 0, spacingPx: this.spacingPx }; }
  placedLabels() { return this.overlay.labels(); }
  /** Test hook: draw now and read one device pixel (CSS coordinates). */
  readPixel(x: number, y: number): [number, number, number, number] {
    if (!this.gl) return [0, 0, 0, 0]; this.drawGL(performance.now()); const out = new Uint8Array(4); this.gl.readPixels(Math.round(x * this.glDpr), this.glCanvas.height - Math.round(y * this.glDpr) - 1, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out); return [out[0], out[1], out[2], out[3]];
  }
  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.raf); this.inter.destroy(); this.service.cancelAll();
    if (this.gl) { this.glCanvas.removeEventListener("webglcontextlost", this.onLost); this.glCanvas.removeEventListener("webglcontextrestored", this.onRestored); for (const L of this.layers) L.layer?.dispose(); this.points?.dispose(); this.P?.dispose(); }   // no loseContext(): React strict mode re-mounts on the same canvas, and a lost context would stay lost
  }

  // ---- per frame
  private syncCur(now: number) {
    if (!this.from || !this.to || !this.cur || !this.curX || !this.curY) return;
    if (this.tweenT0 >= 0) { this.tweenT = tweenProgress(this.tweenT0, now); if (this.tweenT >= 1) this.tweenT0 = -1; }
    mixPositions(this.from, this.to, this.tweenT, this.cur); for (let i = 0; i < this.curX.length; i++) { this.curX[i] = this.cur[2 * i]; this.curY[i] = this.cur[2 * i + 1]; }
  }
  private view(): View { return { view: [this.cam.x, this.cam.y, (2 * this.cam.scale) / this.vp.w, (2 * this.cam.scale) / this.vp.h], res: [this.vp.w, this.vp.h], dpr: this.glDpr }; }
  private loop = () => {
    if (this.destroyed) return; this.raf = requestAnimationFrame(this.loop); const now = performance.now();
    const tweening = this.tweenT0 >= 0; if (tweening) { this.syncCur(now); this.dirty = true; this.labelsDirty = true; }
    if (this.layers.some((L) => L.out || now - L.t0 < CROSSFADE_MS)) this.dirty = true;
    // labels: placement cadence, then fades
    const settled = now - this.lastCamMove > 120;
    if (this.curX && this.curY && needsPlacement({ cameraChanged: this.camDirty, inputsChanged: this.labelsDirty, settled, sinceLast: now - this.overlay.lastPlaced })) {
      this.spacingPx = this.overlay.spacing(this.cam, this.curX, this.curY);
      const cx = this.curX, cy = this.curY; this.overlay.place(this.labelsIn, this.cam, this.spacingPx, (l) => (l.row !== undefined && l.row < cx.length ? { x: cx[l.row], y: cy[l.row] } : l), now);
      this.camDirty = false; this.labelsDirty = false; this.overlayDirty = true; this.dirty = true;
    } else if (this.overlay.animating) { this.overlay.tick(now); this.overlayDirty = true; }
    if (!this.dirty) return; this.dirty = false;
    const t0 = performance.now(); if (this.gl && !this.lost) this.drawGL(now); this.drawOverlay(now); const ms = performance.now() - t0; this.frameMs.push(ms); if (this.frameMs.length > 120) this.frameMs.shift();
  }
  private drawGL(now: number) {
    const gl = this.gl!, v = this.view(); let calls = 0; gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height); gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const zoomA = terrainAlpha(this.spacingPx);
    this.layers = this.layers.filter((L) => { if (L.out && now - L.t0 >= CROSSFADE_MS) { L.layer?.dispose(); return false; } return true; });
    for (const L of this.layers) { if (!L.layer) continue; const f = Math.min(1, (now - L.t0) / CROSSFADE_MS); const a = (L.out ? 1 - f : f) * zoomA; calls += L.layer.drawFill(v, a); }
    for (const L of this.layers) { if (!L.layer) continue; const f = Math.min(1, (now - L.t0) / CROSSFADE_MS); const a = (L.out ? 1 - f : f) * zoomA; calls += L.layer.drawLines(v, a); }
    if (this.points) { const r = pointRadius(this.cam.scale / (this.fitScale || 1)); calls += this.points.draw(v, this.tweenT, r); calls += this.points.drawRing(v, this.tweenT, this.selected, r); }
    this.drawCalls = calls;
  }
  private drawOverlay(now: number) {
    void now; const r = pointRadius(this.cam.scale / (this.fitScale || 1));
    const pts = this.mode === "overlay-only" && this.curX && this.curY && this.data ? { x: this.curX, y: this.curY, rgba: this.data.rgba, radius: r, cam: this.cam, selected: this.selected } : undefined;
    this.overlay.draw({ pointCount: this.curX?.length ?? 0, unitPx: this.cam.scale, notice: this.mode === "overlay-only" ? "terrain needs WebGL2" : undefined, points: pts }); this.overlayDirty = false;
  }
  /** Current (tweened) position of a row, for tests and fly-to. */
  pointAt(row: number): { x: number; y: number } | null { if (!this.curX || !this.curY || row < 0 || row >= this.curX.length) return null; this.syncCur(performance.now()); return { x: this.curX[row], y: this.curY[row] }; }
  /** Project for tests and callers. */
  project(x: number, y: number) { return project(this.cam, this.vp, x, y); }
}
