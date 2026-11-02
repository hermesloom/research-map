import { placeLabels, LabelFader, labelSpacingPx, type LabelIn, type LabelState, type Measure } from "../render/labels";
import { project, type Camera, type Viewport } from "../render/camera";
import { RECENT_RGB, type Highlight } from "../recent";

/** Transparent Canvas 2D layer above the GL canvas: labels (placed with hysteresis, faded), scale bar, point counter, notices; in overlay-only mode also the points. */
export class Overlay {
  private ctx: CanvasRenderingContext2D; private vp: Viewport = { w: 1, h: 1 }; private dpr = 1; private measureCache = new Map<string, number>();
  readonly fader = new LabelFader(); private states: LabelState[] = []; lastPlaced = 0;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext("2d")!; }
  resize(w: number, h: number, dpr: number) { this.vp = { w, h }; this.dpr = dpr; this.canvas.width = Math.max(1, Math.round(w * dpr)); this.canvas.height = Math.max(1, Math.round(h * dpr)); this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`; }
  measure: Measure = (text, px, bold = false) => { const k = `${bold ? "b" : "n"}${px}|${text}`; let w = this.measureCache.get(k); if (w === undefined) { this.ctx.font = `${bold ? "600 " : ""}${px}px system-ui, sans-serif`; w = this.ctx.measureText(text).width; this.measureCache.set(k, w); } return { w, h: px }; };
  /** Average room per visible point (CSS px) for the current positions. */
  spacing(cam: Camera, x: ArrayLike<number>, y: ArrayLike<number>) { return labelSpacingPx(cam, this.vp, x, y); }
  /** Run one placement pass; anchors resolve each label's current position (titles follow the tween). */
  place(labels: LabelIn[], cam: Camera, spacingPx: number, anchor: (l: LabelIn) => { x: number; y: number }, now: number) {
    const anchored = labels.map((l) => { const a = anchor(l); return a.x === l.x && a.y === l.y ? l : { ...l, x: a.x, y: a.y }; });
    const placed = placeLabels(anchored, cam, this.vp, this.measure, spacingPx, 400, this.fader.incumbents()); this.states = this.fader.step(placed, now); this.lastPlaced = now;
  }
  /** Advance fades without re-placing. */
  tick(now: number) { this.states = this.fader.step(this.states.filter((s) => s.target === 1).map((s) => s.box), now); }
  get animating() { return this.fader.animating; }
  labels(): { text: string; level: number; opacity: number; row?: number }[] { return this.states.map((s) => ({ text: s.box.text, level: s.box.level, opacity: s.opacity, row: s.box.row })); }
  /** Draw labels (re-projected from their anchors with the current camera, so they track the map between placement passes), the status bar, and in overlay-only mode the points. */
  draw(cam: Camera, opts: { pointCount: number; unitPx: number; notice?: string; points?: { x: Float32Array; y: Float32Array; rgba: Uint8Array; radius: number; cam: Camera; selected: number; highlights?: Highlight[] } }) {
    const ctx = this.ctx, { w, h } = this.vp; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (opts.points) this.drawPoints(opts.points);
    ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.lineJoin = "round";
    for (const s of this.states) {
      const l = s.box; const p = project(cam, this.vp, l.ax, l.ay); const lx = p.x + l.dx, ly = p.y + l.dy;
      ctx.globalAlpha = s.opacity; ctx.font = `${l.level === 0 ? "600 " : ""}${l.px}px system-ui, sans-serif`; const cx = lx + l.w / 2, cy = ly + l.h / 2;
      ctx.lineWidth = l.level === 0 ? 5 : 3; ctx.strokeStyle = "rgba(11,13,16,0.85)"; ctx.strokeText(l.text, cx, cy);
      ctx.fillStyle = l.level === 0 ? "#f3f3f3" : l.level === 1 ? "rgba(235,235,235,0.92)" : "rgba(220,220,220,0.85)"; ctx.fillText(l.text, cx, cy);
    }
    ctx.globalAlpha = 1;
    // status: scale bar + point count (+ notice) bottom right
    let bar = 1; while (bar * opts.unitPx > 140) bar /= 2; while (bar * opts.unitPx < 50) bar *= 2;
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(230,230,230,0.75)";
    const label = `${opts.pointCount} points`; ctx.fillText(label, w - 14, h - 14); const lw = ctx.measureText(label).width;
    const bx1 = w - 14 - lw - 18, bx0 = bx1 - bar * opts.unitPx; ctx.strokeStyle = "rgba(230,230,230,0.75)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx0, h - 18); ctx.lineTo(bx1, h - 18); ctx.moveTo(bx0, h - 22); ctx.lineTo(bx0, h - 14); ctx.moveTo(bx1, h - 22); ctx.lineTo(bx1, h - 14); ctx.stroke();
    ctx.fillText(String(bar < 1 ? +bar.toFixed(3) : bar), bx0 - 6, h - 14);
    if (opts.notice) { ctx.textAlign = "left"; ctx.fillStyle = "rgba(230,200,120,0.9)"; ctx.fillText(opts.notice, 14, h - 14); }
  }
  private drawPoints(p: { x: Float32Array; y: Float32Array; rgba: Uint8Array; radius: number; cam: Camera; selected: number; highlights?: Highlight[] }) {
    const ctx = this.ctx, { w, h } = this.vp; const groups = new Map<number, Path2D>(); const pad = p.radius + 2; const view = new Uint32Array(p.rgba.buffer, p.rgba.byteOffset, p.rgba.length / 4);
    for (let i = 0; i < p.x.length; i++) {
      const X = w / 2 + (p.x[i] - p.cam.x) * p.cam.scale, Y = h / 2 - (p.y[i] - p.cam.y) * p.cam.scale; if (X < -pad || Y < -pad || X > w + pad || Y > h + pad) continue;
      let path = groups.get(view[i]); if (!path) { path = new Path2D(); groups.set(view[i], path); } path.moveTo(X + p.radius, Y); path.arc(X, Y, p.radius, 0, Math.PI * 2);
    }
    for (const [packed, path] of groups) { const o = [...groups.keys()].indexOf(packed); void o; const i = view.indexOf(packed); ctx.fillStyle = `rgba(${p.rgba[4 * i]},${p.rgba[4 * i + 1]},${p.rgba[4 * i + 2]},${p.rgba[4 * i + 3] / 255})`; ctx.fill(path); }
    for (const hl of p.highlights ?? []) { if (hl.row < 0 || hl.row >= p.x.length) continue; const X = w / 2 + (p.x[hl.row] - p.cam.x) * p.cam.scale, Y = h / 2 - (p.y[hl.row] - p.cam.y) * p.cam.scale; ctx.strokeStyle = `rgba(${RECENT_RGB[0]},${RECENT_RGB[1]},${RECENT_RGB[2]},${hl.alpha})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, p.radius + 5, 0, Math.PI * 2); ctx.stroke(); }
    if (p.selected >= 0 && p.selected < p.x.length) { const X = w / 2 + (p.x[p.selected] - p.cam.x) * p.cam.scale, Y = h / 2 - (p.y[p.selected] - p.cam.y) * p.cam.scale; ctx.strokeStyle = "#9cc4ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, p.radius + 9, 0, Math.PI * 2); ctx.stroke(); }
  }
}
