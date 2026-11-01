import type { Layout, Override } from "./types";
/** Owner curation applied on top of a layout at publish time; never mutates the stored layout. */
export function applyOverrides(layout: Layout, overrides: Override[]): Layout {
  const l: Layout = structuredClone(layout);
  for (const o of overrides) {
    if (o.type === "pin" && o.xId) { const p = l.points.find((p) => p.xId === o.xId); if (p) { p.x = Number(o.payload.x); p.y = Number(o.payload.y); } }
    if (o.type === "renameLabel" && o.clusterId !== undefined) {
      const label = String(o.payload.label);
      for (const c of l.clusters) if (c.id === o.clusterId) c.label = label;
      for (const lb of l.labels) if (lb.clusterId === o.clusterId && lb.level === 1) lb.text = label;
    }
    if (o.type === "moveLeaf" && o.xId) { const p = l.points.find((p) => p.xId === o.xId); if (p) p.clusterId = Number(o.payload.clusterId); }
  }
  return l;
}
