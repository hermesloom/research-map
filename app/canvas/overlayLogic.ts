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
