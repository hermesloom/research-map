import { describe, it, expect } from "vitest";
import { newAccumulator, appendBand, appendRingLines, finalize } from "@/app/canvas/terrain/mesh";
import type { Ring } from "@/app/canvas/terrain/isobands";

const sq = (x0: number, y0: number, s: number): Ring => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
const id = (p: [number, number]) => p;
const inTri = (p: [number, number], a: number[], b: number[], c: number[]) => { const s = (p1: number[], p2: number[], p3: number[]) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };

describe("appendBand", () => {
  it("triangulates a square with a square hole: 8 triangles, valid indices, nothing covers the hole centre", () => {
    const acc = newAccumulator(); appendBand(acc, { outer: sq(0, 0, 10), holes: [sq(4, 4, 2)], band: 1 }, id, [255, 0, 0], 0.175);
    expect(acc.indices.length / 3).toBe(8); const nv = acc.positions.length / 2; expect(Math.max(...acc.indices)).toBeLessThan(nv);
    for (let t = 0; t < acc.indices.length; t += 3) { const v = (k: number) => [acc.positions[2 * acc.indices[t + k]], acc.positions[2 * acc.indices[t + k] + 1]]; expect(inTri([5, 5], v(0), v(1), v(2))).toBe(false); }
  });
  it("writes premultiplied vertex colours at the given alpha", () => {
    const acc = newAccumulator(); appendBand(acc, { outer: sq(0, 0, 10), holes: [], band: 2 }, id, [200, 100, 0], 0.25);
    expect(Array.from(acc.colors.slice(0, 4))).toEqual([50, 25, 0, 64]); expect(acc.colors.length / 4).toBe(acc.positions.length / 2);
  });
  it("stacking the incremental band alphas reproduces the cumulative band alphas 0.175 … 0.55 exactly", async () => {
    const { BAND_ALPHA, BAND_ALPHA_INCREMENT } = await import("@/app/canvas/terrain/types"); let a = 0;
    for (let b = 1; b <= 6; b++) { const inc = BAND_ALPHA_INCREMENT(b); a = 1 - (1 - a) * (1 - inc); expect(a).toBeCloseTo(BAND_ALPHA(b), 9); }
  });
});
describe("appendRingLines", () => {
  it("emits one segment per ring edge with outer/inner styling", () => {
    const acc = newAccumulator(); appendRingLines(acc, sq(0, 0, 10), id, [0, 0, 255], true); appendRingLines(acc, sq(1, 1, 2), id, [0, 0, 255], false);
    expect(acc.lines.length / 4).toBe(8); expect(acc.lineWidths[0]).toBeCloseTo(1.6, 6); expect(acc.lineColors[3]).toBe(Math.round(255 * 0.95));
    expect(acc.lineWidths[4]).toBeCloseTo(1, 6); expect(acc.lineColors[4 * 4 + 3]).toBe(Math.round(255 * 0.6));
  });
});
describe("finalize", () => {
  it("packs typed arrays and counts", () => {
    const acc = newAccumulator(); appendBand(acc, { outer: sq(0, 0, 1), holes: [], band: 6 }, id, [1, 2, 3], 0.55); appendRingLines(acc, sq(0, 0, 1), id, [1, 2, 3], true);
    const m = finalize(acc, { categories: 1, ms: 0, sigmaUnits: 0.1 });
    expect(m.triCount).toBe(2); expect(m.segmentCount).toBe(4); expect(m.indices).toBeInstanceOf(Uint32Array); expect(m.stats.triangles).toBe(2); expect(m.stats.segments).toBe(4);
  });
});
