import { describe, it, expect } from "vitest";
import { easeInOutCubic, tweenProgress, mixPositions, pickNearest, pointRadius, terrainAlpha } from "@/app/canvas/gl/state";

describe("tween", () => {
  it("progress is eased and clamped to [0, 1] over 600 ms", () => {
    expect(tweenProgress(1000, 1000)).toBe(0); expect(tweenProgress(1000, 1300)).toBeCloseTo(easeInOutCubic(0.5), 9); expect(tweenProgress(1000, 1700)).toBe(1); expect(tweenProgress(1000, 999)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9); expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 9);
  });
  it("mixPositions writes from + (to − from) · t into out, so a mid-tween retarget starts where the points are", () => {
    const out = new Float32Array(2); mixPositions(Float32Array.from([0, 10]), Float32Array.from([4, 20]), 0.25, out); expect(Array.from(out)).toEqual([1, 12.5]);
  });
});
describe("pickNearest", () => {
  it("returns the nearest row within the pixel radius using the current (mixed) positions, else -1", () => {
    const x = Float32Array.from([0, 1, 5]), y = Float32Array.from([0, 0, 0]); const cam = { x: 0, y: 0, scale: 100 }, vp = { w: 800, h: 600 };
    expect(pickNearest(x, y, cam, vp, 400 + 100 + 4, 300, 12)).toBe(1);   // 4 px right of row 1
    expect(pickNearest(x, y, cam, vp, 400 + 300, 300, 12)).toBe(-1);      // between rows, nothing within 12 px
  });
});
describe("point radius and terrain alpha", () => {
  it("radius grows with zoom relative to fit and caps at 7 px", () => { expect(pointRadius(1)).toBeCloseTo(3, 9); expect(pointRadius(2)).toBeCloseTo(3.8, 9); expect(pointRadius(1000)).toBe(7); expect(pointRadius(0.5)).toBeCloseTo(3, 9); });
  it("terrain alpha is 1 up to 160 px of room per point and 0.35 from 400 px", () => { expect(terrainAlpha(100)).toBe(1); expect(terrainAlpha(160)).toBe(1); expect(terrainAlpha(280)).toBeCloseTo(0.675, 9); expect(terrainAlpha(400)).toBeCloseTo(0.35, 9); expect(terrainAlpha(Infinity)).toBeCloseTo(0.35, 9); });
});
