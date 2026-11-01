import type { Camera, Viewport } from "./camera";
import { project } from "./camera";
export type LabelIn = { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number; align?: "center" | "right"; px?: number };
export type PlacedLabel = { text: string; x: number; y: number; w: number; h: number; level: number; px: number; align: "center" | "right" };
export const LEVEL_MIN_ZOOM = [0, 1.6, 5];            // zoom relative to the fitted view: themes always; leaves from 1.6×; titles from 5×
export const LEVEL_FONT_PX = [20, 13, 11];
export const levelVisible = (level: number, zoomRel: number) => zoomRel >= (LEVEL_MIN_ZOOM[level] ?? Infinity);
/** Greedy collision placement, highest priority first, coarser levels first; on-screen text labels only. */
export function placeLabels(labels: LabelIn[], cam: Camera, vp: Viewport, measure: (text: string, px: number) => { w: number; h: number }, zoomRel: number, max = 400): PlacedLabel[] {
  const cands: { l: LabelIn; p: { x: number; y: number } }[] = [];
  for (const l of labels) {
    if (typeof l.content !== "string" || !levelVisible(l.level, zoomRel)) continue;
    const p = project(cam, vp, l.x, l.y); if (p.x < -200 || p.y < -50 || p.x > vp.w + 200 || p.y > vp.h + 50) continue; cands.push({ l, p });
  }
  cands.sort((a, b) => a.l.level - b.l.level || b.l.priority - a.l.priority);
  const placed: PlacedLabel[] = [];
  for (const { l, p } of cands) {
    const px = l.px ?? LEVEL_FONT_PX[l.level] ?? 11; const m = measure(l.content as string, px); const align = l.align ?? "center";
    const box = { text: l.content as string, x: align === "right" ? p.x - m.w - 6 : p.x - m.w / 2, y: p.y - m.h / 2, w: m.w + 6, h: m.h + 4, level: l.level, px, align };
    if (placed.some((q) => box.x < q.x + q.w && box.x + box.w > q.x && box.y < q.y + q.h && box.y + box.h > q.y)) continue;
    placed.push(box); if (placed.length >= max) break;
  }
  return placed;
}
