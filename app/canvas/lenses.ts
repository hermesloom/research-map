import type { PointsFile } from "@/lib/snapshot";

export type LensId = "terrain" | "question" | "time";
export interface LensDef { id: LensId; name: string; purpose: string; preserves: string[]; drops: string[]; }
/** Each lens is a partial, structure-preserving view (Goguen); it says what it keeps and what it drops. */
export const LENSES: LensDef[] = [
  { id: "terrain", name: "Topic terrain", purpose: "Where posts sit relative to each other by meaning; density shows the themes I keep returning to.", preserves: ["semantic neighbourhoods", "cluster membership"], drops: ["time", "relevance to the question (only colour intensity)"] },
  { id: "question", name: "Around the question", purpose: "How directly each post speaks to the core question; the question sits at the centre.", preserves: ["angular neighbourhoods from the terrain", "graded relevance as radius"], drops: ["exact semantic distance"] },
  { id: "time", name: "Time strata", purpose: "How the inquiry unfolded: months left to right, sub-questions as rows.", preserves: ["chronology", "sub-question attachment"], drops: ["semantic neighbourhoods"] },
];

const hash01 = (s: string, salt: number) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; };

export function terrainXY(p: PointsFile) { return { x: Float32Array.from(p.x), y: Float32Array.from(p.y) }; }

/** Centre and ring radius of the question lens: the terrain centroid and an eighth of the x extent. */
export function questionGeometry(p: PointsFile) {
  const n = p.count; const cx = p.x.reduce((a, b) => a + b, 0) / n, cy = p.y.reduce((a, b) => a + b, 0) / n;
  const ext = Math.max(...p.x) - Math.min(...p.x) || 1; return { cx, cy, R: ext / 8 };
}
export function questionXY(p: PointsFile, centerId: string) {
  const n = p.count; const { cx, cy, R } = questionGeometry(p);
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

export type LensLabel = { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number; align?: "center" | "right" | "left"; px?: number };
/** Labels for the active lens. Terrain uses the batch job's labels; the other lenses label their own geometry. */
export function lensLabels(id: LensId, p: PointsFile, xy: { x: Float32Array; y: Float32Array }, ctx: { questions: { id: string; text: string; parentId: string | null }[]; subOrder: string[]; terrainLabels: LensLabel[] }): LensLabel[] {
  if (id === "terrain") return ctx.terrainLabels;
  const titles = itemLabelsAt(p, xy, ctx.terrainLabels);
  if (id === "question") {
    const { cx, cy, R } = questionGeometry(p); const core = ctx.questions.find((q) => q.parentId === null)?.text ?? "The question";
    return [{ x: cx, y: cy, content: core, level: 0, priority: 2000 }, ...[3, 2, 1, 0].map((g) => ({ x: cx, y: cy + (3.5 - g) * R, content: `relevance ${g}`, level: 1, priority: 100 + g })), ...titles];
  }
  let minX = Infinity; for (let i = 0; i < xy.x.length; i++) if (xy.x[i] < minX) minX = xy.x[i]; if (!Number.isFinite(minX)) minX = 0;
  const text = (sid: string) => ctx.questions.find((q) => q.id === sid)?.text ?? sid;
  const row = (y: number, content: string, priority: number) => ({ x: minX - 0.2, y, content, level: 0, priority, align: "right" as const, px: 13 });
  return [...ctx.subOrder.map((sid, i) => row(-(i + 0.4), text(sid), 1000 - i)), row(-(ctx.subOrder.length + 0.4), "unassigned", 10), ...titles];
}
/** Per-post labels (level 2) are stored at terrain coordinates; re-anchor them to the post's position in another lens by matching the terrain coordinate. */
export function itemLabelsAt(p: PointsFile, xy: { x: Float32Array; y: Float32Array }, terrainLabels: LensLabel[]): LensLabel[] {
  const byPos = new Map<string, number>(); for (let i = 0; i < p.count; i++) byPos.set(`${p.x[i]},${p.y[i]}`, i);
  const out: LensLabel[] = [];
  for (const l of terrainLabels) { if (l.level !== 2) continue; const i = byPos.get(`${l.x},${l.y}`); if (i === undefined) continue; out.push({ ...l, x: xy.x[i], y: xy.y[i] }); }
  return out;
}

/** Walk an (induced) sub-question up to its seed (direct child of core); null when unknown. */
export function primarySeed(id: string | null, questions: { id: string; parentId: string | null }[]): string | null {
  if (!id) return null; const byId = new Map(questions.map((q) => [q.id, q])); let cur = byId.get(id); let guard = 0;
  while (cur && guard++ < 10) { if (cur.parentId === "core") return cur.id; if (cur.parentId === null) return null; cur = byId.get(cur.parentId); }
  return null;
}
