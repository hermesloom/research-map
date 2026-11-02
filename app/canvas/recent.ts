import type { PointsFile } from "@/lib/snapshot";

export const RECENT_COUNT = 20;
export const RECENT_RGB: [number, number, number] = [255, 209, 102];   // amber, distinct from the blue selection ring
export interface Highlight { row: number; alpha: number }

/** The newest `count` displayed posts (rows index into `idx`), newest first, with opacity stepping from 1 down to 1/count. Ties on time break towards the larger id (later post). */
export function recentHighlights(points: Pick<PointsFile, "createdAt" | "ids">, idx: number[], count = RECENT_COUNT): Highlight[] {
  const order = idx.map((i, row) => row).sort((a, b) => points.createdAt[idx[b]] - points.createdAt[idx[a]] || (BigInt(points.ids[idx[b]]) > BigInt(points.ids[idx[a]]) ? 1 : -1));
  return order.slice(0, count).map((row, k) => ({ row, alpha: (count - k) / count }));
}
