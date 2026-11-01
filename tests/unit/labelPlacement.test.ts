import { describe, it, expect } from "vitest";
import { placeLabels, levelVisible, type PlacedLabel } from "@/app/canvas/render/labels";
const measure = (text: string, px: number) => ({ w: text.length * px * 0.6, h: px });
describe("label placement", () => {
  it("levels appear by the room each visible point has on screen (lens-independent): themes always, cluster labels from 40 px, titles from 100 px", () => {
    expect(levelVisible(0, 1)).toBe(true); expect(levelVisible(1, 39)).toBe(false); expect(levelVisible(1, 40)).toBe(true); expect(levelVisible(2, 99)).toBe(false); expect(levelVisible(2, 100)).toBe(true);
  });
  it("drops overlapping labels in priority order and never draws off-screen ones", () => {
    const labels = [
      { x: 0, y: 0, content: "A high", level: 0, priority: 10 }, { x: 0.1, y: 0, content: "B low", level: 0, priority: 1 },   // overlaps A at this scale
      { x: 5, y: 5, content: "C far", level: 0, priority: 5 }, { x: 1000, y: 1000, content: "D off", level: 0, priority: 100 },
    ];
    const placed: PlacedLabel[] = placeLabels(labels, { x: 0, y: 0, scale: 50 }, { w: 800, h: 600 }, measure, 1);
    expect(placed.map((p) => p.text)).toEqual(["A high", "C far"]);
  });
  it("image labels are skipped by the text placer", () => {
    const placed = placeLabels([{ x: 0, y: 0, content: { image: "u", width: 1, height: 1 }, level: 2, priority: 1 }], { x: 0, y: 0, scale: 500 }, { w: 800, h: 600 }, measure, 100);
    expect(placed).toEqual([]);
  });
});

describe("title labels", () => { it("appear once each visible point has about 100 px of room (cards are gone; node labels carry the detail)", () => { expect(levelVisible(2, 99)).toBe(false); expect(levelVisible(2, 100)).toBe(true); }); });
describe("label spacing measure", () => {
  it("labelSpacingPx = sqrt(viewport area / points in view): the average room per visible point, in CSS px (off-screen clusters do not count)", async () => {
    const { labelSpacingPx } = await import("@/app/canvas/render/labels");
    const vp = { w: 800, h: 600 }; const cam = { x: 0, y: 0, scale: 30 };
    const x = new Float32Array([0, 1, 2, 3, 100, 100.01, 100.02, 100.03, 100.04]), y = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);   // four in view, five far off-screen
    expect(labelSpacingPx(cam, vp, x, y)).toBeCloseTo(Math.sqrt(800 * 600 / 4), 6);
    expect(labelSpacingPx(cam, vp, new Float32Array(0), new Float32Array(0))).toBe(Infinity);
  });
});

describe("right-aligned labels", () => {
  it("places a right-aligned label's box to the left of its anchor and honours a px override", () => {
    const placed = placeLabels([{ x: 0, y: 0, content: "Row", level: 0, priority: 1, align: "right", px: 13 }], { x: 0, y: 0, scale: 50 }, { w: 800, h: 600 }, measure, 1);
    expect(placed.length).toBe(1); expect(placed[0].x + placed[0].w).toBeLessThanOrEqual(400 + 1); expect(placed[0].px).toBe(13); expect(placed[0].align).toBe("right");
  });
});

describe("item titles", () => {
  it("level-2 labels default to left alignment with an 8 px offset so they don't cover the dot", () => {
    const placed = placeLabels([{ x: 0, y: 0, content: "Title", level: 2, priority: 1 }], { x: 0, y: 0, scale: 50 }, { w: 800, h: 600 }, measure, 100);
    expect(placed[0].align).toBe("left"); expect(placed[0].x).toBeGreaterThanOrEqual(400 + 8);
  });
});
