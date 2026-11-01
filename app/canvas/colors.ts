import type { MetaFile, PointsFile } from "@/lib/snapshot";

export const LEAF_PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#aec7e8", "#ffbb78", "#98df8a", "#c5b0d5"];
const SLOTS = 61; const ALPHA = [0.18, 0.45, 0.85, 1.0];
/** EmbeddingView has one Uint8 category per point: we encode (leaf slot, grade) into it. Slot 60 = unclustered. */
/** grade -1 (ungraded) is displayed like grade 1. */
const effectiveGrade = (g: number) => (g < 0 ? 1 : Math.min(3, Math.max(0, Math.round(g))));
export function categoryIndex(leaf: number, grade: number) { const slot = leaf < 0 ? SLOTS - 1 : leaf % (SLOTS - 1); return slot * 4 + effectiveGrade(grade); }
const withAlpha = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
export function categoryColors(): string[] {
  const out: string[] = [];
  for (let s = 0; s < SLOTS; s++) { const base = s === SLOTS - 1 ? "#cfcfcf" : LEAF_PALETTE[s % LEAF_PALETTE.length]; for (let g = 0; g < 4; g++) out.push(withAlpha(base, ALPHA[g])); }
  return out;
}
export function visibleMask(p: PointsFile, minGrade: number, showAll: boolean, f: { kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] }, meta: MetaFile | null): Uint8Array {
  const m = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let v = showAll || effectiveGrade(p.grade[i]) >= minGrade;
    if (v && f.kinds && !f.kinds.has(p.kind[i])) v = false;
    if (v && f.langs && meta && !f.langs.has(meta.lang[i])) v = false;
    if (v && f.monthRange) { const t = p.createdAt[i]; if (t < f.monthRange[0] || t > f.monthRange[1]) v = false; }
    m[i] = v ? 1 : 0;
  }
  return m;
}
