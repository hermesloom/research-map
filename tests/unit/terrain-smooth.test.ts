import { describe, it, expect } from "vitest";
import { simplifyRing, chaikin, smoothRing } from "@/app/canvas/terrain/smooth";
import { ringArea, type Ring } from "@/app/canvas/terrain/isobands";

const square = (s = 10): Ring => [[0, 0], [s, 0], [s, s], [0, s], [0, 0]];
describe("chaikin", () => {
  it("keeps the ring closed and doubles the edge count per pass", () => {
    const r = chaikin(square(), 1); expect(r[0]).toEqual(r[r.length - 1]); expect(r.length - 1).toBe(8);
    expect(chaikin(square(), 2).length - 1).toBe(16);
  });
});
describe("simplifyRing", () => {
  it("removes collinear points within tolerance and keeps closure", () => {
    const r: Ring = [[0, 0], [5, 0.01], [10, 0], [10, 10], [0, 10], [0, 0]]; const s = simplifyRing(r, 0.5);
    expect(s.length).toBe(5); expect(s[0]).toEqual(s[s.length - 1]);
  });
  it("returns degenerate rings unchanged", () => { const r: Ring = [[0, 0], [1, 1], [0, 0]]; expect(simplifyRing(r, 1)).toBe(r); });
});
describe("smoothRing", () => {
  it("rounds corners (no vertex left at the original corner); a 24-gon keeps its area within 3 %", () => {
    const s = smoothRing(square(20)); expect(s.some(([x, y]) => x === 0 && y === 0)).toBe(false); expect(s[0]).toEqual(s[s.length - 1]);
    const circle: Ring = Array.from({ length: 25 }, (_, i) => [20 * Math.cos((i / 24) * 2 * Math.PI), 20 * Math.sin((i / 24) * 2 * Math.PI)]); circle[24] = circle[0];
    const a0 = Math.abs(ringArea(circle)), a1 = Math.abs(ringArea(smoothRing(circle))); expect(a1 / a0).toBeGreaterThan(0.97); expect(a1 / a0).toBeLessThan(1.01);
  });
});
