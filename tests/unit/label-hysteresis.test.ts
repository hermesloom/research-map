import { describe, it, expect } from "vitest";
import { placeLabels, labelKey, LabelFader, needsPlacement, PLACEMENT_PAD_PX, type LabelIn } from "@/app/canvas/render/labels";

const measure = (text: string, px: number) => ({ w: text.length * px * 0.6, h: px });
const cam = { x: 0, y: 0, scale: 50 }, vp = { w: 800, h: 600 };

describe("incumbency", () => {
  it("an incumbent label beats a newcomer of equal priority that overlaps it", () => {
    const labels: LabelIn[] = [{ x: 0, y: 0, content: "Old", level: 1, priority: 5 }, { x: 0.1, y: 0, content: "New", level: 1, priority: 5 }];
    const first = placeLabels(labels, cam, vp, measure, 1000); expect(first.map((l) => l.text)).toEqual(["Old"]);
    const flipped = placeLabels([labels[1], labels[0]], cam, vp, measure, 1000); expect(flipped.map((l) => l.text)).toEqual(["New"]);   // without incumbency, input order decides ties
    const kept = placeLabels([labels[1], labels[0]], cam, vp, measure, 1000, 400, new Set([labelKey(labels[0])])); expect(kept.map((l) => l.text)).toEqual(["Old"]);
  });
  it("incumbency never promotes a label above a higher-priority newcomer", () => {
    const labels: LabelIn[] = [{ x: 0, y: 0, content: "Old", level: 1, priority: 1 }, { x: 0.1, y: 0, content: "Big", level: 1, priority: 50 }];
    expect(placeLabels(labels, cam, vp, measure, 1000, 400, new Set([labelKey(labels[0])])).map((l) => l.text)).toEqual(["Big"]);
  });
});
describe("padding", () => {
  it(`considers labels up to ${PLACEMENT_PAD_PX} px outside the viewport and ignores farther ones`, () => {
    const inside = { x: (400 + PLACEMENT_PAD_PX - 10) / 50, y: 0, content: "near", level: 0, priority: 1 }, far = { x: (400 + PLACEMENT_PAD_PX + 50) / 50, y: 0, content: "far", level: 0, priority: 1 };
    expect(placeLabels([inside, far], cam, vp, measure, 1000).map((l) => l.text)).toEqual(["near"]);
  });
});
describe("LabelFader", () => {
  it("fades a new label in over 150 ms, holds it, fades it out after it disappears, then drops it", () => {
    const f = new LabelFader(); const box = { text: "A", x: 0, y: 0, w: 10, h: 10, level: 0, px: 20, align: "center" as const, key: "k", ax: 0, ay: 0, dx: 0, dy: 0 };
    let s = f.step([box], 1000); expect(s[0].opacity).toBe(0);
    s = f.step([box], 1075); expect(s[0].opacity).toBeCloseTo(0.5, 2);
    s = f.step([box], 1200); expect(s[0].opacity).toBe(1);
    s = f.step([], 1250); expect(s.length).toBe(1); expect(s[0].opacity).toBeCloseTo(1 - 50 / 150, 2);
    s = f.step([], 1500); expect(s.length).toBe(0);
  });
  it("a label that reappears while fading out fades back in from its current opacity", () => {
    const f = new LabelFader(); const box = { text: "A", x: 0, y: 0, w: 10, h: 10, level: 0, px: 20, align: "center" as const, key: "k", ax: 0, ay: 0, dx: 0, dy: 0 };
    f.step([box], 0); f.step([box], 300); f.step([], 375); const s = f.step([box], 376); expect(s[0].opacity).toBeGreaterThan(0.4); expect(s[0].opacity).toBeLessThan(0.6);
  });
  it("reports whether another frame is needed", () => {
    const f = new LabelFader(); const box = { text: "A", x: 0, y: 0, w: 10, h: 10, level: 0, px: 20, align: "center" as const, key: "k", ax: 0, ay: 0, dx: 0, dy: 0 };
    f.step([box], 0); expect(f.animating).toBe(true); f.step([box], 500); expect(f.animating).toBe(false);
  });
});
describe("needsPlacement", () => {
  it("re-places at most every 120 ms while the camera moves, immediately once it settles, and never when nothing changed", () => {
    expect(needsPlacement({ cameraChanged: true, inputsChanged: false, settled: false, sinceLast: 50 })).toBe(false);
    expect(needsPlacement({ cameraChanged: true, inputsChanged: false, settled: false, sinceLast: 130 })).toBe(true);
    expect(needsPlacement({ cameraChanged: true, inputsChanged: false, settled: true, sinceLast: 10 })).toBe(true);
    expect(needsPlacement({ cameraChanged: false, inputsChanged: true, settled: true, sinceLast: 0 })).toBe(true);
    expect(needsPlacement({ cameraChanged: false, inputsChanged: false, settled: true, sinceLast: 5000 })).toBe(false);
  });
});

describe("stable label identity", () => {
  it("a title's key depends on its row, not on its (tweened) position; structural labels key on tier, text and lens anchor", () => {
    const a = { x: 0, y: 0, content: "T", level: 2, priority: 1, row: 7 }, b = { x: 3, y: 4, content: "T", level: 2, priority: 1, row: 7 };
    expect(labelKey(a)).toBe(labelKey(b)); expect(labelKey({ ...a, row: 8 })).not.toBe(labelKey(a));
    expect(labelKey({ x: 0, y: 0, content: "Theme", level: 0, priority: 1 })).not.toBe(labelKey({ x: 1, y: 0, content: "Theme", level: 0, priority: 1 }));
  });
  it("placed labels remember their anchor and the offset from it, so they can be re-projected every frame", () => {
    const placed = placeLabels([{ x: 2, y: 1, content: "Title", level: 2, priority: 1, row: 3 }], cam, vp, measure, 1000);
    expect(placed[0].ax).toBe(2); expect(placed[0].ay).toBe(1); expect(placed[0].dx).toBe(8); expect(Math.abs(placed[0].dy)).toBeLessThan(10);
  });
});
