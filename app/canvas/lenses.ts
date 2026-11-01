import type { PointsFile } from "@/lib/snapshot";

export type LensId = "terrain" | "question" | "time";
export interface LensDef { id: LensId; name: string; purpose: string; preserves: string[]; drops: string[]; }
/** Each lens is a partial, structure-preserving view (Goguen); it says what it keeps and what it drops. */
export const LENSES: LensDef[] = [
  { id: "terrain", name: "Topic terrain", purpose: "Where posts sit relative to each other by meaning; density shows the themes I keep returning to.", preserves: ["semantic neighbourhoods", "cluster membership"], drops: ["time", "relevance to the question (only colour intensity)"] },
  { id: "question", name: "Around the question", purpose: "How directly each post speaks to the core question; the question sits at the centre.", preserves: ["angular neighbourhoods from the terrain", "graded relevance as radius"], drops: ["density", "exact semantic distance"] },
  { id: "time", name: "Time strata", purpose: "How the inquiry unfolded: months left to right, sub-questions as rows.", preserves: ["chronology", "sub-question attachment"], drops: ["semantic neighbourhoods"] },
];

const hash01 = (s: string, salt: number) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; };

export function terrainXY(p: PointsFile) { return { x: Float32Array.from(p.x), y: Float32Array.from(p.y) }; }

export function questionXY(p: PointsFile, centerId: string) {
  const n = p.count; const cx = p.x.reduce((a, b) => a + b, 0) / n, cy = p.y.reduce((a, b) => a + b, 0) / n;
  const ext = Math.max(...p.x) - Math.min(...p.x) || 1; const R = ext / 8;
  const x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (p.ids[i] === centerId) { x[i] = cx; y[i] = cy; continue; }
    const ang = Math.atan2(p.y[i] - cy, p.x[i] - cx);
    const r = (3.5 - Math.min(3, Math.max(0, p.grade[i]))) * R + (hash01(p.ids[i], 1) - 0.5) * R * 0.8;
    x[i] = cx + r * Math.cos(ang); y[i] = cy + r * Math.sin(ang);
  }
  return { x, y };
}

export function timeXY(p: PointsFile, primarySub: (string | null)[], subOrder: string[]) {
  const n = p.count; const month = (t: number) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const counts = new Map<number, number>(); for (let i = 0; i < n; i++) counts.set(month(p.createdAt[i]), (counts.get(month(p.createdAt[i])) ?? 0) + 1);
  const months = [...counts.keys()].sort((a, b) => a - b); const start = new Map<number, [number, number]>(); let cur = 0;
  for (const m of months) { const w = Math.log1p(counts.get(m)!); start.set(m, [cur, w]); cur += w + 0.2; }
  const rows = new Map(subOrder.map((s, i) => [s, i])); const lastRow = subOrder.length;
  const x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [s, w] = start.get(month(p.createdAt[i]))!; x[i] = s + hash01(p.ids[i], 2) * w;
    const row = primarySub[i] && rows.has(primarySub[i]!) ? rows.get(primarySub[i]!)! : lastRow; y[i] = -(row + hash01(p.ids[i], 3) * 0.8);
  }
  return { x, y };
}

export function lensXY(id: LensId, p: PointsFile, ctx: { centerId: string; primarySub: (string | null)[]; subOrder: string[] }) {
  return id === "terrain" ? terrainXY(p) : id === "question" ? questionXY(p, ctx.centerId) : timeXY(p, ctx.primarySub, ctx.subOrder);
}
/** Ease-in-out cubic interpolation into `out`. */
export function tween(a: Float32Array, b: Float32Array, t: number, out: Float32Array) {
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * e; return out;
}
