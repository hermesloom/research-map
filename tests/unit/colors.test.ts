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

describe("ungraded (-1) handling", () => {
  it("is coloured like grade 1 and shown at the default threshold, hidden above it", () => {
    expect(categoryIndex(0, -1)).toBe(categoryIndex(0, 1));
    const p: any = { count: 2, grade: [-1, 2], leaf: [0, 0], kind: [0, 0], createdAt: [0, 0] };
    expect(Array.from(visibleMask(p, 1, false, {}, null))).toEqual([1, 1]);
    expect(Array.from(visibleMask(p, 2, false, {}, null))).toEqual([0, 1]);
  });
});

describe("rgbaForRows", () => {
  it("packs palette colour + grade alpha per visible row as RGBA bytes (ungraded like grade 1, unclustered grey)", async () => {
    const { rgbaForRows, catRGBFor } = await import("@/app/canvas/colors");
    const p: any = { count: 3, leaf: [0, -1, 1], grade: [3, -1, 0], leaves: [{ id: 0 }, { id: 1 }] };
    const rgba = rgbaForRows(p, [0, 1, 2]);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0x4e, 0x79, 0xa7, 255]);              // leaf 0 → palette[0], grade 3 → alpha 1
    expect(Array.from(rgba.slice(4, 8))).toEqual([0xcf, 0xcf, 0xcf, Math.round(0.45 * 255)]);   // unclustered grey, ungraded → grade 1 alpha
    expect(Array.from(rgba.slice(8, 12))).toEqual([0xf2, 0x8e, 0x2b, Math.round(0.18 * 255)]);  // leaf 1 → palette[1], grade 0
    const cats = catRGBFor(p); expect(cats[0]).toEqual([0xcf, 0xcf, 0xcf]); expect(cats[1]).toEqual([0x4e, 0x79, 0xa7]); expect(cats[2]).toEqual([0xf2, 0x8e, 0x2b]);
  });
});
