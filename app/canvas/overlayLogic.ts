import type { MetaFile, PointsFile } from "@/lib/snapshot";

/** Rows whose projected pixel is inside the viewport, nearest to the centre first, capped. */
export function visibleRows(xs: Float32Array, ys: Float32Array, proj: (x: number, y: number) => { x: number; y: number }, w: number, h: number, max = 50): number[] {
  const rows: [number, number][] = [];
  for (let r = 0; r < xs.length; r++) { const p = proj(xs[r], ys[r]); if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) rows.push([r, (p.x - w / 2) ** 2 + (p.y - h / 2) ** 2]); }
  return rows.sort((a, b) => a[1] - b[1]).slice(0, max).map((r) => r[0]);
}
export function newestRows(p: PointsFile, idx: number[], k = 20): number[] {
  return idx.map((i, r) => [r, p.createdAt[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, k).map((r) => r[0]);
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** One card. Meets X's display minimum: name + handle, unaltered text (gist), timestamp linking to the permalink. */
export function cardHtml(meta: MetaFile, i: number, point: { grade: number; provisional: boolean; url: string; date?: string }): string {
  return `<div class="card g${point.grade}${point.provisional ? " provisional" : ""}"><div class="t">${esc(meta.title[i] ?? "")}</div><div class="g">${esc((meta.gist[i] ?? "").slice(0, 200))}</div>
<div class="m">${meta.domain[i] ? `<span>${esc(meta.domain[i]!)}</span>` : ""}<span class="role">${esc(meta.role[i] ?? "")}</span>${point.provisional ? '<span class="prov">provisional</span>' : ""}</div>
<div class="x">Julian · @sigalor · <a href="${esc(point.url)}" target="_blank" rel="noopener">${esc(point.date ?? "open on X")}</a></div></div>`;
}

export type ProxyLike = { location: (x: number, y: number) => { x: number; y: number }; width: number; height: number };
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
