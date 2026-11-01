import type { Camera, Viewport } from "./camera";
import { project } from "./camera";
export type LabelIn = { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number; align?: "center" | "right" | "left"; px?: number };
export type PlacedLabel = { text: string; x: number; y: number; w: number; h: number; level: number; px: number; align: "center" | "right" | "left" };
/** Label tiers switch on the average room each visible point has on screen (CSS px), so every lens behaves the same: themes always; cluster labels from 40 px; post titles from 100 px. */
export const LEVEL_MIN_SPACING_PX = [0, 40, 100];
export const LEVEL_FONT_PX = [20, 13, 11];
export const levelVisible = (level: number, spacingPx: number) => spacingPx >= (LEVEL_MIN_SPACING_PX[level] ?? Infinity);
/** Average room per visible point: sqrt(viewport area / number of points inside the viewport), in CSS px; Infinity when nothing is in view. */
export function labelSpacingPx(cam: Camera, vp: Viewport, x: ArrayLike<number>, y: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) { const p = project(cam, vp, x[i], y[i]); if (p.x >= 0 && p.x <= vp.w && p.y >= 0 && p.y <= vp.h) n++; }
  return n === 0 ? Infinity : Math.sqrt((vp.w * vp.h) / n);
}
/** Greedy collision placement, highest priority first, coarser levels first; on-screen text labels only. */
export function placeLabels(labels: LabelIn[], cam: Camera, vp: Viewport, measure: (text: string, px: number) => { w: number; h: number }, spacingPx: number, max = 400): PlacedLabel[] {
  const cands: { l: LabelIn; p: { x: number; y: number } }[] = [];
  for (const l of labels) {
    if (typeof l.content !== "string" || !levelVisible(l.level, spacingPx)) continue;
    const p = project(cam, vp, l.x, l.y); if (p.x < -200 || p.y < -50 || p.x > vp.w + 200 || p.y > vp.h + 50) continue; cands.push({ l, p });
  }
  cands.sort((a, b) => a.l.level - b.l.level || b.l.priority - a.l.priority);
  const placed: PlacedLabel[] = [];
  for (const { l, p } of cands) {
    const px = l.px ?? LEVEL_FONT_PX[l.level] ?? 11; const m = measure(l.content as string, px); const align = l.align ?? (l.level === 2 ? "left" : "center");
    const box = { text: l.content as string, x: align === "right" ? p.x - m.w - 6 : align === "left" ? p.x + 8 : p.x - m.w / 2, y: p.y - m.h / 2, w: m.w + 6, h: m.h + 4, level: l.level, px, align };
    if (placed.some((q) => box.x < q.x + q.w && box.x + box.w > q.x && box.y < q.y + q.h && box.y + box.h > q.y)) continue;
    placed.push(box); if (placed.length >= max) break;
  }
  return placed;
}
