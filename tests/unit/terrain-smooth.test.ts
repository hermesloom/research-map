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

import { chaikinOpen, smoothOpen, splitRing, canonicalArc } from "@/app/canvas/terrain/smooth";
describe("arc smoothing for shared boundaries", () => {
  const arc: Ring = [[0, 0], [1, 0.2], [2, 0], [3, 0.3], [4, 0]];
  it("chaikinOpen keeps both endpoints and doubles the interior", () => { const r = chaikinOpen(arc, 1); expect(r[0]).toEqual([0, 0]); expect(r[r.length - 1]).toEqual([4, 0]); expect(r.length).toBe(2 * (arc.length - 1)); });
  it("smoothOpen of an arc and of its reverse are exact mirror images (so both sides of a seam agree)", () => {
    const a = smoothOpen(canonicalArc(arc)), b = smoothOpen(canonicalArc([...arc].reverse())); expect(a).toEqual(b);
  });
  it("splitRing cuts a closed ring into maximal runs of density edges and seam edges, in ring order", () => {
    const ring: Ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]];
    const density = (p: [number, number], q: [number, number]) => (p[1] + q[1]) / 2 < 1;   // bottom half = density boundary
    const arcs = splitRing(ring, density); expect(arcs.map((a) => a.density)).toEqual([false, true]);   // maximal runs, wrapping past the ring start: seam (2,1)…(0,1), density (0,1)…(0,0)…(2,1)
    expect(arcs.map((a) => a.pts.length)).toEqual([5, 5]);
    expect(arcs[0].pts[arcs[0].pts.length - 1]).toEqual(arcs[1].pts[0]); expect(arcs[1].pts[arcs[1].pts.length - 1]).toEqual(arcs[0].pts[0]);
  });
  it("a ring with a single edge type stays one closed arc", () => { const arcs = splitRing(square(10), () => true); expect(arcs.length).toBe(1); expect(arcs[0].closed).toBe(true); });
});
