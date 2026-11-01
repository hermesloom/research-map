import { describe, it, expect } from "vitest";
import { categoryIndex, categoryColors, visibleMask } from "@/app/canvas/colors";
describe("colors", () => {
  it("category index is stable, bounded, and separates grades", () => {
    const cols = categoryColors(); expect(cols.length).toBeLessThanOrEqual(256);
    expect(categoryIndex(0, 3)).not.toBe(categoryIndex(0, 1)); expect(categoryIndex(-1, 2)).toBeLessThan(cols.length); expect(categoryIndex(500, 0)).toBeLessThan(cols.length);
  });
  it("visibleMask hides below minGrade unless showAll; unclustered points are never hidden by leaf", () => {
    const p: any = { count: 3, grade: [3, 0, 2], leaf: [0, -1, -1], kind: [0, 0, 1], createdAt: [0, 0, 0] };
    expect(Array.from(visibleMask(p, 1, false, {}, null))).toEqual([1, 0, 1]);
    expect(Array.from(visibleMask(p, 1, true, {}, null))).toEqual([1, 1, 1]);
    expect(Array.from(visibleMask(p, 0, true, { kinds: new Set([1]) }, null))).toEqual([0, 0, 1]);
  });
});
