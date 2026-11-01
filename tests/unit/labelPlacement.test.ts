import { describe, it, expect } from "vitest";
import { placeLabels, levelVisible, type PlacedLabel } from "@/app/canvas/render/labels";
const measure = (text: string, px: number) => ({ w: text.length * px * 0.6, h: px });
describe("label placement", () => {
  it("levels appear with zoom RELATIVE to the fitted view: themes always, leaves from 1.6×, titles from 8×", () => {
    expect(levelVisible(0, 1)).toBe(true); expect(levelVisible(1, 1.5)).toBe(false); expect(levelVisible(1, 1.6)).toBe(true); expect(levelVisible(2, 7.9)).toBe(false); expect(levelVisible(2, 8)).toBe(true);
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
