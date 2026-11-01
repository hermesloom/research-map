import type { Db } from "mongodb";
import type { Layout, LayoutPoint } from "./types";
import { cosine, jitterFromId } from "./llm/embed";

export interface Neighbor { xId: string; score: number; x: number; y: number; clusterId: number; }

export function medianNNSpacing(points: LayoutPoint[]): number {
  if (points.length < 2) return 1;
  const sample = points.length > 400 ? points.filter((_, i) => i % Math.ceil(points.length / 400) === 0) : points;
  const d = sample.map((p) => { let best = Infinity; for (const q of points) { if (q === p) continue; const dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd < best) best = dd; } return best; }).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 1;
}

/** Snap to the single best neighbour plus a small deterministic jitter. Never average coordinates (44% cluster-correct on this corpus vs 72% for snapping). */
export function placeFromNeighbors(xId: string, neighbors: Neighbor[], opts: { medianSpacing: number; clusterNameVectors?: Map<number, number[]>; itemVector?: number[] }): LayoutPoint {
  if (!neighbors.length) throw new Error("no neighbours");
  const top = [...neighbors].sort((a, b) => b.score - a.score)[0];
  const [jx, jy] = jitterFromId(xId); const r = 0.3 * opts.medianSpacing;
  const votes = new Map<number, number>(); for (const n of neighbors) if (n.clusterId !== -1) votes.set(n.clusterId, (votes.get(n.clusterId) ?? 0) + 1);
  let clusterId = -1;
  if (votes.size) {
    const max = Math.max(...votes.values()); const tied = [...votes.entries()].filter(([, v]) => v === max).map(([k]) => k);
    if (tied.length === 1) clusterId = tied[0];
    else if (opts.itemVector && opts.clusterNameVectors) {
      clusterId = tied.map((c) => [c, opts.clusterNameVectors!.has(c) ? cosine(opts.itemVector!, opts.clusterNameVectors!.get(c)!) : -1] as const).sort((a, b) => b[1] - a[1])[0][0];
    } else clusterId = tied.includes(top.clusterId) ? top.clusterId : tied[0];
  }
  return { xId, x: top.x + r * jx, y: top.y + r * jy, clusterId, provisional: true };
}

export async function knnNeighbors(db: Db, embedding: number[], layout: Layout, k = 10): Promise<Neighbor[]> {
  const byId = new Map(layout.points.map((p) => [p.xId, p]));
  const rows = await db.collection("vectors").aggregate<{ xId: string; score: number }>([
    { $vectorSearch: { index: "embedding_idx", path: "embedding", queryVector: embedding, exact: true, limit: k * 3 } },
    { $project: { _id: 0, xId: 1, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  return rows.filter((r) => byId.has(r.xId)).slice(0, k).map((r) => { const p = byId.get(r.xId)!; return { xId: r.xId, score: r.score, x: p.x, y: p.y, clusterId: p.clusterId }; });
}

export async function placeItem(db: Db, xId: string, embedding: number[], layout: Layout): Promise<LayoutPoint> {
  const neighbors = (await knnNeighbors(db, embedding, layout)).filter((n) => n.xId !== xId);
  return placeFromNeighbors(xId, neighbors, { medianSpacing: medianNNSpacing(layout.points), itemVector: embedding });
}
