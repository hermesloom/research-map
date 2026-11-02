import type { LensId } from "./lenses";
export interface UrlState { lens: LensId; minGrade: number; showAll: boolean; recent: boolean; q?: string; sel?: string; v?: [number, number, number]; }
export function parseUrlState(search: string): UrlState {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search); const s: UrlState = { lens: "terrain", minGrade: 1, showAll: false, recent: false };
  const lens = sp.get("lens"); if (lens === "terrain" || lens === "question" || lens === "time") s.lens = lens;
  const g = Number(sp.get("g")); if (sp.has("g") && Number.isInteger(g) && g >= 0 && g <= 3) s.minGrade = g;
  if (sp.get("all") === "1") s.showAll = true; if (sp.get("recent") === "1") s.recent = true; const q = sp.get("q"); if (q) s.q = q; const sel = sp.get("sel"); if (sel) s.sel = sel;
  const v = sp.get("v")?.split(",").map(Number); if (v && v.length === 3 && v.every(Number.isFinite)) s.v = v as [number, number, number];
  return s;
}
export function serializeUrlState(s: UrlState): string {
  const sp = new URLSearchParams();
  if (s.lens !== "terrain") sp.set("lens", s.lens); if (s.minGrade !== 1) sp.set("g", String(s.minGrade)); if (s.showAll) sp.set("all", "1"); if (s.recent) sp.set("recent", "1");
  if (s.q) sp.set("q", s.q); if (s.sel) sp.set("sel", s.sel); if (s.v) sp.set("v", s.v.join(","));
  const str = sp.toString(); return str ? `?${str}` : "";
}
