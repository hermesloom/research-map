/** Camera in data space: (x, y) is the data point at the viewport centre; scale = CSS pixels per data unit; y grows upward. */
export type Camera = { x: number; y: number; scale: number };
export type Viewport = { w: number; h: number };
export function project(c: Camera, vp: Viewport, x: number, y: number) { return { x: vp.w / 2 + (x - c.x) * c.scale, y: vp.h / 2 - (y - c.y) * c.scale }; }
export function unproject(c: Camera, vp: Viewport, X: number, Y: number) { return { x: c.x + (X - vp.w / 2) / c.scale, y: c.y - (Y - vp.h / 2) / c.scale }; }
/** Zoom by `factor` keeping the data point under pixel (X, Y) fixed. */
export function zoomAt(c: Camera, vp: Viewport, X: number, Y: number, factor: number): Camera {
  const before = unproject(c, vp, X, Y); const scale = Math.min(20000, Math.max(0.01, c.scale * factor)); const tmp = { ...c, scale }; const after = unproject(tmp, vp, X, Y);
  return { x: c.x + (before.x - after.x), y: c.y + (before.y - after.y), scale };
}
export function fitCamera(x: ArrayLike<number>, y: ArrayLike<number>, vp: Viewport, fill = 0.9): Camera {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < x.length; i++) { if (x[i] < xmin) xmin = x[i]; if (x[i] > xmax) xmax = x[i]; if (y[i] < ymin) ymin = y[i]; if (y[i] > ymax) ymax = y[i]; }
  if (!Number.isFinite(xmin)) return { x: 0, y: 0, scale: 1 };
  const sx = (vp.w * fill) / ((xmax - xmin) || 1), sy = (vp.h * fill) / ((ymax - ymin) || 1);
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2, scale: Math.min(sx, sy) };
}
/** Keep zoom within a useful range of the fitted view (0.25× … 80×) so nobody gets lost in empty space. */
export const clampScale = (scale: number, fitScale: number) => Math.min(fitScale * 80, Math.max(fitScale * 0.25, scale));
/** Fit points plus extra anchors (e.g. structural label positions) into the viewport. */
export function fitCameraTo(x: ArrayLike<number>, y: ArrayLike<number>, anchors: { x: number; y: number }[], vp: Viewport, fill = 0.9): Camera {
  const ax = new Float64Array(x.length + anchors.length), ay = new Float64Array(x.length + anchors.length);
  for (let i = 0; i < x.length; i++) { ax[i] = x[i]; ay[i] = y[i]; } anchors.forEach((a, k) => { ax[x.length + k] = a.x; ay[x.length + k] = a.y; });
  return fitCamera(ax, ay, vp, fill);
}
