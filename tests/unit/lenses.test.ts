import { describe, it, expect } from "vitest";
import { terrainXY, questionXY, timeXY, tween, LENSES } from "@/app/canvas/lenses";
const p: any = { ids: ["q", "a", "b", "c"], x: [0, 1, -1, 0], y: [0, 0, 0, 2], grade: [3, 3, 1, 0], createdAt: [1700000000, 1702600000, 1705200000, 1705200000], leaf: [0, 0, 1, -1], count: 4 };
describe("lenses", () => {
  it("terrain copies coordinates into Float32Arrays", () => { const r = terrainXY(p); expect(r.x).toBeInstanceOf(Float32Array); expect(Array.from(r.x)).toEqual([0, 1, -1, 0]); });
  it("question lens puts the centre item at the centroid and higher grades closer", () => {
    const r = questionXY(p, "q"); const cx = r.x[0], cy = r.y[0];
    const d = (i: number) => Math.hypot(r.x[i] - cx, r.y[i] - cy);
    expect(d(1)).toBeLessThan(d(2)); expect(d(2)).toBeLessThan(d(3));
  });
  it("question lens preserves each point's angle around the terrain centroid", () => {
    const r = questionXY(p, "q"); const cx = r.x[0], cy = r.y[0];            // centre item sits at the terrain centroid (0, 0.5)
    expect(Math.atan2(r.y[1] - cy, r.x[1] - cx)).toBeCloseTo(Math.atan2(0 - 0.5, 1 - 0), 5);
  });
  it("time lens orders x by month and rows by sub-question", () => {
    const r = timeXY(p, [null, "s1", "s2", null], ["s1", "s2"]);
    expect(r.x[1]).toBeLessThan(r.x[2]); expect(r.y[1]).toBeGreaterThan(r.y[2]); expect(Math.abs(r.x[2] - r.x[3])).toBeLessThan(Math.log1p(2) + 1e-9); // same month bin
  });
  it("tween eases between arrays", () => {
    const a = new Float32Array([0, 0]), b = new Float32Array([10, 20]), out = new Float32Array(2);
    expect(Array.from(tween(a, b, 0, out))).toEqual([0, 0]); expect(Array.from(tween(a, b, 1, out))).toEqual([10, 20]); expect(tween(a, b, 0.5, out)[1]).toBeCloseTo(10);
  });
  it("every lens declares purpose, preserves and drops", () => { for (const l of LENSES) { expect(l.purpose.length).toBeGreaterThan(10); expect(l.preserves.length).toBeGreaterThan(0); expect(l.drops.length).toBeGreaterThan(0); } });
});
