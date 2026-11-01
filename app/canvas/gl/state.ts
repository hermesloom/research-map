import { unproject, type Camera, type Viewport } from "../render/camera";

export const TWEEN_MS = 600;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Eased tween progress in [0, 1] for a tween started at t0. */
export function tweenProgress(t0: number, now: number): number { const t = Math.min(1, Math.max(0, (now - t0) / TWEEN_MS)); return easeInOutCubic(t); }
/** out = from + (to − from) · t (t already eased). */
export function mixPositions(from: Float32Array, to: Float32Array, t: number, out: Float32Array): Float32Array { for (let i = 0; i < from.length; i++) out[i] = from[i] + (to[i] - from[i]) * t; return out; }
/** Nearest row to pixel (X, Y) within radiusPx, or -1. */
export function pickNearest(x: Float32Array, y: Float32Array, cam: Camera, vp: Viewport, X: number, Y: number, radiusPx: number): number {
  const d = unproject(cam, vp, X, Y); const r = radiusPx / cam.scale; let best = -1, bd = r * r;
  for (let i = 0; i < x.length; i++) { const dd = (x[i] - d.x) ** 2 + (y[i] - d.y) ** 2; if (dd <= bd) { bd = dd; best = i; } }
  return best;
}
/** Point radius in CSS px from zoom relative to the fitted view. */
export const pointRadius = (zoomRel: number) => Math.min(7, 3 + Math.log2(Math.max(1, zoomRel)) * 0.8);
/** Terrain opacity from the room per visible point: full up to 160 px, 0.35 from 400 px (same rule in every lens). */
export const terrainAlpha = (spacingPx: number) => (spacingPx <= 160 ? 1 : spacingPx >= 400 ? 0.35 : 1 - ((spacingPx - 160) / 240) * 0.65);
