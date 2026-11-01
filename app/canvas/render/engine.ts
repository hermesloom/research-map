import { project, unproject, zoomAt, fitCamera, type Camera, type Viewport } from "./camera";
import { placeLabels, type LabelIn } from "./labels";
import { rasterSpec, medianSpacing } from "./density";
import { computeDensityGrid, marchingSquares, bandLevels, bandOf } from "./contours";
import { tween } from "../lenses";
import { nearestRowAt, type ProxyLike } from "../overlayLogic";

/** cat: density category per row (0 = unclustered, leaf+1 otherwise); catColor: colour per category. */
export type EngineData = { x: Float32Array; y: Float32Array; color: string[]; cat: Uint16Array; catColor: string[]; provisional: Uint8Array; newest: number[] };
export type EngineOpts = { onCamera?: (c: Camera) => void; onPick?: (row: number) => void };

/** Plain Canvas 2D map renderer: terrain raster + points + rings + collision-placed labels. No GPU API dependency. */
export class MapEngine {
  private ctx: CanvasRenderingContext2D; private vp: Viewport = { w: 800, h: 600 }; private dpr = 1;
  private cam: Camera = { x: 0, y: 0, scale: 1 }; private fitScale = 1;
  private data: EngineData | null = null; private pos: { x: Float32Array; y: Float32Array } | null = null;
  private tweenFrom: { x: Float32Array; y: Float32Array } | null = null; private tweenTo: { x: Float32Array; y: Float32Array } | null = null; private tweenT0 = 0;
  private labels: LabelIn[] = []; private selected = -1; private dirty = true; private raf = 0; private destroyed = false;
  private terrain: { canvas: HTMLCanvasElement; x0: number; x1: number; y0: number; y1: number } | null = null; private terrainTimer: number | null = null;
  private measureCache = new Map<string, number>();
  private drag: { id: number; X: number; Y: number; moved: boolean } | null = null; private pinch: Map<number, { X: number; Y: number }> = new Map(); private pinchDist = 0;
  readonly proxy: ProxyLike;

  constructor(private canvas: HTMLCanvasElement, private opts: EngineOpts = {}) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.proxy = { location: (x: number, y: number) => project(this.cam, this.vp, x, y), get width() { return 0; }, get height() { return 0; } };
    Object.defineProperty(this.proxy, "width", { get: () => this.vp.w }); Object.defineProperty(this.proxy, "height", { get: () => this.vp.h }); Object.defineProperty(this.proxy, "zoomRel", { get: () => this.cam.scale / this.fitScale });
    canvas.style.touchAction = "none"; canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", this.onDown); canvas.addEventListener("pointermove", this.onMove); canvas.addEventListener("pointerup", this.onUp); canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false }); canvas.addEventListener("dblclick", this.onDbl);
    this.loop();
  }
  get camera() { return this.cam; }
  resize(w: number, h: number, dpr: number) {
    this.vp = { w, h }; this.dpr = dpr; this.canvas.width = Math.max(1, Math.round(w * dpr)); this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`; this.dirty = true;
  }
  /** New point set (same length as the current lens target). Positions snap immediately; use setTarget for an animated move. */
  setData(d: EngineData, initialCamera?: Camera | null) {
    const first = !this.data; this.data = d;
    if (!this.pos || this.pos.x.length !== d.x.length) { this.pos = { x: Float32Array.from(d.x), y: Float32Array.from(d.y) }; this.tweenFrom = this.tweenTo = null; }
    if (first) { const fit = fitCamera(d.x, d.y, this.vp, 0.85); this.fitScale = fit.scale; this.setCamera(initialCamera ?? fit); }
    this.scheduleTerrain(); this.dirty = true;
  }
  /** Animate every point from its current position to (x, y) over 600 ms. */
  setTarget(x: Float32Array, y: Float32Array) {
    if (!this.pos || this.pos.x.length !== x.length) { this.pos = { x: Float32Array.from(x), y: Float32Array.from(y) }; this.scheduleTerrain(); this.dirty = true; return; }
    this.tweenFrom = { x: Float32Array.from(this.pos.x), y: Float32Array.from(this.pos.y) }; this.tweenTo = { x, y }; this.tweenT0 = performance.now(); this.dirty = true;
  }
  setLabels(l: LabelIn[]) { this.labels = l; this.dirty = true; }
  setSelected(row: number) { this.selected = row; this.dirty = true; }
  setCamera(c: Camera) { this.cam = c; this.dirty = true; this.opts.onCamera?.(c); }
  flyTo(x: number, y: number, scale?: number) { this.setCamera({ x, y, scale: scale ?? Math.max(this.cam.scale, this.fitScale * 8) }); }
  fit() { if (this.pos) this.setCamera(fitCamera(this.pos.x, this.pos.y, this.vp, 0.85)); }
  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.raf); if (this.terrainTimer) clearTimeout(this.terrainTimer);
    const c = this.canvas; c.removeEventListener("pointerdown", this.onDown); c.removeEventListener("pointermove", this.onMove); c.removeEventListener("pointerup", this.onUp); c.removeEventListener("pointercancel", this.onUp); c.removeEventListener("wheel", this.onWheel); c.removeEventListener("dblclick", this.onDbl);
  }

  // ---- interaction
  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId); this.pinch.set(e.pointerId, { X: e.offsetX, Y: e.offsetY });
    if (this.pinch.size === 2) { const [a, b] = [...this.pinch.values()]; this.pinchDist = Math.hypot(a.X - b.X, a.Y - b.Y); this.drag = null; return; }
    this.drag = { id: e.pointerId, X: e.offsetX, Y: e.offsetY, moved: false }; this.canvas.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    if (this.pinch.has(e.pointerId)) this.pinch.set(e.pointerId, { X: e.offsetX, Y: e.offsetY });
    if (this.pinch.size === 2) {
      const [a, b] = [...this.pinch.values()]; const dist = Math.hypot(a.X - b.X, a.Y - b.Y); if (this.pinchDist > 0 && dist > 0) this.setCamera(zoomAt(this.cam, this.vp, (a.X + b.X) / 2, (a.Y + b.Y) / 2, dist / this.pinchDist)); this.pinchDist = dist; return;
    }
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dX = e.offsetX - this.drag.X, dY = e.offsetY - this.drag.Y; if (Math.hypot(dX, dY) > 3) this.drag.moved = true;
    this.setCamera({ x: this.cam.x - dX / this.cam.scale, y: this.cam.y + dY / this.cam.scale, scale: this.cam.scale }); this.drag.X = e.offsetX; this.drag.Y = e.offsetY;
  };
  private onUp = (e: PointerEvent) => {
    this.pinch.delete(e.pointerId); this.canvas.style.cursor = "grab";
    if (this.drag && this.drag.id === e.pointerId) {
      const wasClick = !this.drag.moved; this.drag = null;
      if (wasClick && this.pos && this.data) { const row = nearestRowAt(this.pos.x, this.pos.y, this.proxy, e.offsetX, e.offsetY, 12); if (row >= 0) this.opts.onPick?.(row); }
    }
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)); this.setCamera(zoomAt(this.cam, this.vp, e.offsetX, e.offsetY, factor)); };
  private onDbl = (e: MouseEvent) => { this.setCamera(zoomAt(this.cam, this.vp, e.offsetX, e.offsetY, 2)); };

  // ---- terrain (once per point set, off the hot path)
  private scheduleTerrain() {
    if (this.terrainTimer) clearTimeout(this.terrainTimer);
    this.terrainTimer = window.setTimeout(() => { this.terrainTimer = null; this.buildTerrain(); }, 50);
  }
  private buildTerrain() {
    const d = this.data, pos = this.pos; if (!d || !pos || pos.x.length === 0) { this.terrain = null; return; }
    const spec = rasterSpec(pos.x, pos.y, 512, 0.1); const { width: gw, height: gh } = spec;
    const bw = Math.max(2.5, Math.min(14, medianSpacing(pos.x, pos.y) * spec.pxPerUnit * 1.4));
    const grid = computeDensityGrid(pos.x, pos.y, d.cat, { width: gw, height: gh, x0: spec.x0, x1: spec.x1, y0: spec.y0, y1: spec.y1 }, bw);
    const levels = bandLevels(grid.max);
    // band fill raster: category colour, alpha growing with the band
    const off = document.createElement("canvas"); off.width = gw; off.height = gh; const g = off.getContext("2d")!; const img = g.createImageData(gw, gh); const px = img.data;
    const rgb = d.catColor.map(parseRGB);
    for (let k = 0; k < grid.D.length; k++) { const b = bandOf(grid.D[k], levels); if (b === 0) continue; const c = rgb[grid.bestCat[k]] ?? [200, 200, 200]; const o = k * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(255 * (0.10 + 0.075 * b)); }
    g.putImageData(img, 0, 0);
    // contour lines per (category, level) as Path2D in grid coordinates; stroked each frame under the current transform
    const paths = new Map<string, { color: string; path: Path2D; outer: boolean }>();
    levels.forEach((iso, li) => {
      for (const [x0, y0, x1, y1] of marchingSquares(grid.D, gw, gh, iso)) {
        const cell = Math.min(gh - 1, Math.floor((y0 + y1) / 2)) * gw + Math.min(gw - 1, Math.floor((x0 + x1) / 2)); const cat = grid.bestCat[cell];
        const key = `${cat}|${li === 0 ? "o" : "i"}`; let e = paths.get(key); if (!e) { e = { color: d.catColor[cat] ?? "rgb(200,200,200)", path: new Path2D(), outer: li === 0 }; paths.set(key, e); }
        e.path.moveTo(x0, y0); e.path.lineTo(x1, y1);
      }
    });
    // Bake bands + lines into one high-resolution image (crisp up to the zoom where the terrain has faded out), so each frame is a single drawImage.
    const upscale = Math.max(1, Math.min(4, Math.floor(2048 / gw))); const big = document.createElement("canvas"); big.width = gw * upscale; big.height = gh * upscale; const B = big.getContext("2d")!;
    B.imageSmoothingEnabled = true; B.drawImage(off, 0, 0, big.width, big.height);
    B.setTransform(upscale, 0, 0, upscale, 0, 0); B.lineJoin = "round"; B.lineCap = "round";
    for (const L of paths.values()) { B.lineWidth = (L.outer ? 1.6 : 1) / upscale * 1.5; B.strokeStyle = L.outer ? withAlpha(L.color, 0.9) : withAlpha(L.color, 0.55); B.stroke(L.path); }
    this.terrain = { canvas: big, x0: spec.x0, x1: spec.x1, y0: spec.y0, y1: spec.y1 }; this.dirty = true;
  }

  // ---- render loop
  private loop = () => {
    if (this.destroyed) return; this.raf = requestAnimationFrame(this.loop);
    if (this.tweenTo && this.tweenFrom && this.pos) {
      const t = Math.min(1, (performance.now() - this.tweenT0) / 600); tween(this.tweenFrom.x, this.tweenTo.x, t, this.pos.x); tween(this.tweenFrom.y, this.tweenTo.y, t, this.pos.y); this.dirty = true;
      if (t >= 1) { this.tweenFrom = this.tweenTo = null; this.scheduleTerrain(); }
    }
    if (!this.dirty) return; this.dirty = false; this.draw();
  };
  private measure(text: string, px: number) { const k = `${px}|${text}`; let w = this.measureCache.get(k); if (w === undefined) { this.ctx.font = `${px}px system-ui, sans-serif`; w = this.ctx.measureText(text).width; this.measureCache.set(k, w); } return { w, h: px }; }
  private draw() {
    const ctx = this.ctx, { w, h } = this.vp; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.fillStyle = "#0b0d10"; ctx.fillRect(0, 0, w, h);
    const d = this.data, pos = this.pos; if (!d || !pos) return; const cam = this.cam;
    // terrain fades out as you zoom in (points take over)
    if (this.terrain) {
      const T = this.terrain; const alpha = Math.max(0, Math.min(1, 1 - (cam.scale / this.fitScale - 2.5) / 5));
      if (alpha > 0) { const a = project(cam, this.vp, T.x0, T.y1), b = project(cam, this.vp, T.x1, T.y0); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.drawImage(T.canvas, a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; }
    }
    // points, batched by colour
    const radius = Math.min(7, 3 + Math.log2(Math.max(1, cam.scale / this.fitScale)) * 0.8); const groups = new Map<string, Path2D>(); const pad = radius + 2;
    for (let i = 0; i < pos.x.length; i++) {
      const X = w / 2 + (pos.x[i] - cam.x) * cam.scale, Y = h / 2 - (pos.y[i] - cam.y) * cam.scale; if (X < -pad || Y < -pad || X > w + pad || Y > h + pad) continue;
      let path = groups.get(d.color[i]); if (!path) { path = new Path2D(); groups.set(d.color[i], path); } path.moveTo(X + radius, Y); path.arc(X, Y, radius, 0, Math.PI * 2);
    }
    for (const [color, path] of groups) { ctx.fillStyle = color; ctx.fill(path); }
    // rings: provisional (hollow white), newest (gold halo + trail), selected (blue)
    ctx.lineWidth = 1.2;
    if (d.newest.length) { ctx.strokeStyle = "rgba(255,217,102,0.25)"; ctx.beginPath(); d.newest.slice().reverse().forEach((r, k) => { const p = project(cam, this.vp, pos.x[r], pos.y[r]); if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke();
      ctx.strokeStyle = "rgba(255,217,102,0.6)"; for (const r of d.newest) { const p = project(cam, this.vp, pos.x[r], pos.y[r]); ctx.beginPath(); ctx.arc(p.x, p.y, radius + 7, 0, Math.PI * 2); ctx.stroke(); } }
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; for (let i = 0; i < pos.x.length; i++) if (d.provisional[i]) { const p = project(cam, this.vp, pos.x[i], pos.y[i]); if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue; ctx.beginPath(); ctx.arc(p.x, p.y, radius + 3.5, 0, Math.PI * 2); ctx.stroke(); }
    if (this.selected >= 0 && this.selected < pos.x.length) { const p = project(cam, this.vp, pos.x[this.selected], pos.y[this.selected]); ctx.strokeStyle = "#9cc4ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, radius + 9, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1.2; }
    // labels
    const placed = placeLabels(this.labels, cam, this.vp, (t, px) => this.measure(t, px), cam.scale / this.fitScale);
    ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.lineJoin = "round";
    for (const l of placed) {
      ctx.font = `${l.level === 0 ? "600 " : ""}${l.px}px system-ui, sans-serif`; const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      ctx.lineWidth = l.level === 0 ? 5 : 3; ctx.strokeStyle = "rgba(11,13,16,0.85)"; ctx.strokeText(l.text, cx, cy);
      ctx.fillStyle = l.level === 0 ? "#f3f3f3" : l.level === 1 ? "rgba(235,235,235,0.92)" : "rgba(220,220,220,0.85)"; ctx.fillText(l.text, cx, cy);
    }
    // status bar: scale bar + point count (bottom right)
    const unitPx = cam.scale; let bar = 1; while (bar * unitPx > 140) bar /= 2; while (bar * unitPx < 50) bar *= 2;
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(230,230,230,0.75)";
    const label = `${pos.x.length} points`; ctx.fillText(label, w - 14, h - 14); const lw = ctx.measureText(label).width;
    const bx1 = w - 14 - lw - 18, bx0 = bx1 - bar * unitPx; ctx.strokeStyle = "rgba(230,230,230,0.75)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx0, h - 18); ctx.lineTo(bx1, h - 18); ctx.moveTo(bx0, h - 22); ctx.lineTo(bx0, h - 14); ctx.moveTo(bx1, h - 22); ctx.lineTo(bx1, h - 14); ctx.stroke();
    ctx.fillText(String(bar < 1 ? +bar.toFixed(3) : bar), bx0 - 6, h - 14);
  }
}
function parseRGB(c: string): [number, number, number] { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) return [+m[1], +m[2], +m[3]]; const h = c.match(/^#([0-9a-f]{6})$/i); if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } return [200, 200, 200]; }
function withAlpha(c: string, a: number) { const [r, g, b] = parseRGB(c); return `rgba(${r},${g},${b},${a})`; }
export { unproject };
