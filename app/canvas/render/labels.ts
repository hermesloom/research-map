import type { Camera, Viewport } from "./camera";
import { project } from "./camera";
export type LabelIn = { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number; align?: "center" | "right" | "left"; px?: number; row?: number };
/** ax/ay: data-space anchor; dx/dy: box offset from the projected anchor, so the box can be re-projected every frame between placement passes. */
export type PlacedLabel = { text: string; x: number; y: number; w: number; h: number; level: number; px: number; align: "center" | "right" | "left"; key: string; ax: number; ay: number; dx: number; dy: number; row?: number };
/** Label tiers switch on the average room each visible point has on screen (CSS px), so every lens behaves the same: themes always; cluster labels from 40 px; post titles from 100 px. */
export const LEVEL_MIN_SPACING_PX = [0, 40, 100];
export const LEVEL_FONT_PX = [20, 13, 11];
/** Collision region extends this far beyond the viewport, so labels do not pop as they slide in (MapLibre uses the same idea). */
export const PLACEMENT_PAD_PX = 100;
/** Incumbents (placed in the previous pass) win ties within their tier; the bonus never crosses a real priority difference of ≥ 1. */
const INCUMBENT_BONUS = 0.5;
export const FADE_MS = 150;
export const levelVisible = (level: number, spacingPx: number) => spacingPx >= (LEVEL_MIN_SPACING_PX[level] ?? Infinity);
/** Average room per visible point: sqrt(viewport area / number of points inside the viewport), in CSS px; Infinity when nothing is in view. */
export function labelSpacingPx(cam: Camera, vp: Viewport, x: ArrayLike<number>, y: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) { const p = project(cam, vp, x[i], y[i]); if (p.x >= 0 && p.x <= vp.w && p.y >= 0 && p.y <= vp.h) n++; }
  return n === 0 ? Infinity : Math.sqrt((vp.w * vp.h) / n);
}
/** Stable identity: titles by row (their position tweens), structural labels by tier, text and lens anchor. */
export const labelKey = (l: LabelIn) => (l.row !== undefined ? `${l.level}|row:${l.row}` : `${l.level}|${typeof l.content === "string" ? l.content : "img"}|${l.x.toFixed(4)}|${l.y.toFixed(4)}`);
/** Greedy collision placement, coarser tiers first, then priority (incumbents win ties); on-screen (plus padding) text labels only. */
export type Measure = (text: string, px: number, bold?: boolean) => { w: number; h: number };
export function placeLabels(labels: LabelIn[], cam: Camera, vp: Viewport, measure: Measure, spacingPx: number, max = 400, incumbents?: Set<string>): PlacedLabel[] {
  const cands: { l: LabelIn; p: { x: number; y: number }; key: string; prio: number }[] = []; const pad = PLACEMENT_PAD_PX;
  for (const l of labels) {
    if (typeof l.content !== "string" || !levelVisible(l.level, spacingPx)) continue;
    const p = project(cam, vp, l.x, l.y); if (p.x < -pad || p.y < -pad || p.x > vp.w + pad || p.y > vp.h + pad) continue;
    const key = labelKey(l); cands.push({ l, p, key, prio: l.priority + (incumbents?.has(key) ? INCUMBENT_BONUS : 0) });
  }
  cands.sort((a, b) => a.l.level - b.l.level || b.prio - a.prio);
  const placed: PlacedLabel[] = [];
  for (const { l, p, key } of cands) {
    const px = l.px ?? LEVEL_FONT_PX[l.level] ?? 11; const m = measure(l.content as string, px, l.level === 0); const align = l.align ?? (l.level === 2 ? "left" : "center");
    const bx = align === "right" ? p.x - m.w - 6 : align === "left" ? p.x + 8 : p.x - m.w / 2, by = p.y - m.h / 2;
    const box: PlacedLabel = { text: l.content as string, x: bx, y: by, w: m.w + 6, h: m.h + 4, level: l.level, px, align, key, ax: l.x, ay: l.y, dx: bx - p.x, dy: by - p.y, row: l.row };
    if (placed.some((q) => box.x < q.x + q.w && box.x + box.w > q.x && box.y < q.y + q.h && box.y + box.h > q.y)) continue;
    placed.push(box); if (placed.length >= max) break;
  }
  return placed;
}
/** Placement cadence: at most every 120 ms while moving, immediately when settled or when inputs changed, never when nothing changed. */
export function needsPlacement(s: { cameraChanged: boolean; inputsChanged: boolean; settled: boolean; sinceLast: number }): boolean {
  if (s.inputsChanged) return true; if (!s.cameraChanged) return false; return s.settled || s.sinceLast >= 120;
}
export type LabelState = { box: PlacedLabel; opacity: number; target: 0 | 1 };
/** Per-label opacity ramps (150 ms linear) between placement passes: new labels fade in, dropped labels fade out and are removed once invisible. */
export class LabelFader {
  private states = new Map<string, LabelState>(); private last = -1; animating = false;
  step(placed: PlacedLabel[], now: number): LabelState[] {
    const dt = this.last < 0 ? 0 : Math.max(0, now - this.last); this.last = now; const d = dt / FADE_MS; const present = new Set<string>();
    for (const box of placed) { present.add(box.key); const s = this.states.get(box.key); if (s) { s.box = box; s.target = 1; } else this.states.set(box.key, { box, opacity: 0, target: 1 }); }
    let animating = false; const out: LabelState[] = [];
    for (const [key, s] of this.states) {
      if (!present.has(key)) s.target = 0;
      if (s.target === 1 && s.opacity < 1) { s.opacity = Math.min(1, s.opacity + d); if (s.opacity < 1) animating = true; }
      else if (s.target === 0 && s.opacity > 0) { s.opacity = Math.max(0, s.opacity - d); if (s.opacity > 0) animating = true; }
      if (s.target === 0 && s.opacity <= 0) { this.states.delete(key); continue; }
      out.push(s);
    }
    this.animating = animating; return out;
  }
  incumbents(): Set<string> { const s = new Set<string>(); for (const [k, v] of this.states) if (v.target === 1) s.add(k); return s; }
  clear() { this.states.clear(); this.animating = false; }
}
