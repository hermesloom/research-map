import { describe, it, expect } from "vitest";
import { recentHighlights, RECENT_COUNT } from "@/app/canvas/recent";

const mk = (n: number) => ({ ids: Array.from({ length: n }, (_, i) => String(1000 + i)), createdAt: Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 86400) });
describe("recentHighlights", () => {
  it("picks the 20 newest displayed rows, newest first, opacity 1.0 down to 0.05", () => {
    const p = mk(50); const idx = Array.from({ length: 50 }, (_, i) => i); const h = recentHighlights(p, idx);
    expect(h).toHaveLength(RECENT_COUNT); expect(h[0]).toEqual({ row: 49, alpha: 1 }); expect(h[1].row).toBe(48); expect(h[1].alpha).toBeCloseTo(0.95, 9); expect(h[19]).toEqual({ row: 30, alpha: 0.05 });
    expect(h.map((x) => x.alpha)).toEqual([...h.map((x) => x.alpha)].sort((a, b) => b - a));
  });
  it("rows index into the displayed set, so hidden posts never take a slot", () => {
    const p = mk(50); const idx = [3, 10, 49, 7];   // only four rows displayed; row 2 is the newest
    expect(recentHighlights(p, idx)).toEqual([{ row: 2, alpha: 1 }, { row: 1, alpha: 0.95 }, { row: 3, alpha: 0.9 }, { row: 0, alpha: 0.85 }]);
  });
  it("breaks time ties towards the later (larger) id", () => {
    const p = { ids: ["5", "12", "9"], createdAt: [1, 1, 1] }; expect(recentHighlights(p, [0, 1, 2], 3).map((h) => h.row)).toEqual([1, 2, 0]);
  });
  it("empty when nothing is displayed", () => { expect(recentHighlights(mk(5), [])).toEqual([]); });
});
