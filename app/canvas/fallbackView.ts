import type { ViewportState } from "embedding-atlas/react";
export type OrthoViewState = { target: [number, number, number]; zoom: number };
/** Fit the data extent; the target is in the same data space the layers draw in (no y flip anywhere). */
export function initialViewState(x: Float32Array, y: Float32Array, viewportPx = 600): OrthoViewState {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < x.length; i++) { if (x[i] < xmin) xmin = x[i]; if (x[i] > xmax) xmax = x[i]; if (y[i] < ymin) ymin = y[i]; if (y[i] > ymax) ymax = y[i]; }
  if (!Number.isFinite(xmin)) return { target: [0, 0, 0], zoom: 0 };
  const span = Math.max(xmax - xmin, ymax - ymin) || 1;
  return { target: [(xmin + xmax) / 2, (ymin + ymax) / 2, 0], zoom: Math.log2(viewportPx / span) };
}
/** Embedding Atlas `scale` maps data units to [-1, 1]: pixels per unit = scale × max(w, h) / 2. deck zoom = log2(pixels per unit). */
const pxPerUnitOfScale = (scale: number, w: number, h: number) => scale * Math.max(w, h) / 2;
export const toViewState = (v: ViewportState, w: number, h: number): OrthoViewState => ({ target: [v.x, v.y, 0], zoom: Math.log2(pxPerUnitOfScale(v.scale, w, h)) });
export const toViewport = (v: OrthoViewState, w: number, h: number): ViewportState => ({ x: v.target[0], y: v.target[1], scale: Math.pow(2, v.zoom) / (Math.max(w, h) / 2) });
