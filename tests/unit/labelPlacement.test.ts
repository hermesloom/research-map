import { describe, it, expect } from "vitest";
import { placeLabels, levelVisible, type PlacedLabel } from "@/app/canvas/render/labels";
const measure = (text: string, px: number) => ({ w: text.length * px * 0.6, h: px });
describe("label placement", () => {
  it("levels appear with zoom RELATIVE to the fitted view: themes always, leaves from 1.6×, titles from 5×", () => {
    expect(levelVisible(0, 1)).toBe(true); expect(levelVisible(1, 1.5)).toBe(false); expect(levelVisible(1, 1.6)).toBe(true); expect(levelVisible(2, 4.9)).toBe(false); expect(levelVisible(2, 5)).toBe(true);
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
    const placed = placeLabels([{ x: 0, y: 0, content: { image: "u", width: 1, height: 1 }, level: 2, priority: 1 }], { x: 0, y: 0, scale: 500 }, { w: 800, h: 600 }, measure, 10);
    expect(placed).toEqual([]);
  });
});

describe("title labels", () => { it("appear from 5× the fitted zoom (cards are gone; node labels carry the detail)", () => { expect(levelVisible(2, 4.9)).toBe(false); expect(levelVisible(2, 5)).toBe(true); }); });

describe("right-aligned labels", () => {
  it("places a right-aligned label's box to the left of its anchor and honours a px override", () => {
    const placed = placeLabels([{ x: 0, y: 0, content: "Row", level: 0, priority: 1, align: "right", px: 13 }], { x: 0, y: 0, scale: 50 }, { w: 800, h: 600 }, measure, 1);
    expect(placed.length).toBe(1); expect(placed[0].x + placed[0].w).toBeLessThanOrEqual(400 + 1); expect(placed[0].px).toBe(13); expect(placed[0].align).toBe("right");
  });
});

describe("item titles", () => {
  it("level-2 labels default to left alignment with an 8 px offset so they don't cover the dot", () => {
    const placed = placeLabels([{ x: 0, y: 0, content: "Title", level: 2, priority: 1 }], { x: 0, y: 0, scale: 50 }, { w: 800, h: 600 }, measure, 10);
    expect(placed[0].align).toBe("left"); expect(placed[0].x).toBeGreaterThanOrEqual(400 + 8);
  });
});
