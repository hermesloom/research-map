
/** Rows whose projected pixel is inside the viewport, nearest to the centre first, capped. */
export function visibleRows(xs: Float32Array, ys: Float32Array, proj: (x: number, y: number) => { x: number; y: number }, w: number, h: number, max = 50): number[] {
  const rows: [number, number][] = [];
  for (let r = 0; r < xs.length; r++) { const p = proj(xs[r], ys[r]); if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) rows.push([r, (p.x - w / 2) ** 2 + (p.y - h / 2) ** 2]); }
  return rows.sort((a, b) => a[1] - b[1]).slice(0, max).map((r) => r[0]);
}
export type ProxyLike = { location: (x: number, y: number) => { x: number; y: number }; width: number; height: number; zoomRel?: number };
/** Recover the (affine) data→pixel mapping from two projections so clicks can be mapped back to data space. */
export function affineFromProxy(proxy: ProxyLike) {
  const o = proxy.location(0, 0), px = proxy.location(1, 0), py = proxy.location(0, 1);
  const sx = px.x - o.x || 1e-9, sy = py.y - o.y || 1e-9;
  return { pxPerUnit: Math.abs(sx), toPixel: (x: number, y: number) => ({ x: o.x + x * sx, y: o.y + y * sy }), toData: (X: number, Y: number) => ({ x: (X - o.x) / sx, y: (Y - o.y) / sy }) };
}
/** Nearest row to a pixel position within `radiusPx`, or -1. */
export function nearestRowAt(xs: Float32Array, ys: Float32Array, proxy: ProxyLike, X: number, Y: number, radiusPx = 12): number {
  const a = affineFromProxy(proxy); const d = a.toData(X, Y); const r = radiusPx / a.pxPerUnit; let best = -1, bd = r * r;
  for (let i = 0; i < xs.length; i++) { const dd = (xs[i] - d.x) ** 2 + (ys[i] - d.y) ** 2; if (dd <= bd) { bd = dd; best = i; } }
  return best;
}
