import type { MetaFile, PointsFile } from "@/lib/snapshot";
/** JSON Canvas 1.0 snapshot: one group per theme, one link/text node per post (Obsidian-compatible). */
export function toJsonCanvas(p: PointsFile, meta: MetaFile, scale = 40) {
  const nodes: Record<string, unknown>[] = []; const W = 260, H = 120;
  for (const t of p.themes) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < p.count; i++) if (p.theme[i] === t.id) { xs.push(p.x[i] * scale); ys.push(-p.y[i] * scale); }
    if (!xs.length) continue;
    const x0 = Math.round(Math.min(...xs)) - 40, y0 = Math.round(Math.min(...ys)) - 60;
    nodes.push({ id: `theme-${t.id}`, type: "group", label: t.label, x: x0, y: y0, width: Math.round(Math.max(...xs)) - x0 + W + 40, height: Math.round(Math.max(...ys)) - y0 + H + 40 });
  }
  for (let i = 0; i < p.count; i++) {
    const base = { id: p.ids[i], x: Math.round(p.x[i] * scale), y: Math.round(-p.y[i] * scale), width: W, height: H };
    nodes.push(meta.url[i] ? { ...base, type: "link", url: meta.url[i] } : { ...base, type: "text", text: `**${meta.title[i]}**\n\n${meta.gist[i]}` });
  }
  return { nodes, edges: [] as unknown[] };
}
