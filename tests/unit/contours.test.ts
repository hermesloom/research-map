import { describe, it, expect } from "vitest";
import { computeDensityGrid, marchingSquares, bandLevels, bandOf } from "@/app/canvas/render/contours";
describe("density grid", () => {
  it("peaks at the point location and records the dominant category there", () => {
    const g = computeDensityGrid(new Float32Array([0.5]), new Float32Array([0.5]), new Uint16Array([7]), { width: 64, height: 64, x0: 0, x1: 1, y0: 0, y1: 1 }, 6);
    const cx = 32, cy = 31; const peak = g.D[cy * 64 + cx];
    expect(peak).toBeGreaterThan(0); expect(peak).toBeCloseTo(g.max, 5); expect(g.bestCat[cy * 64 + cx]).toBe(7);
    expect(g.D[0]).toBeLessThan(peak * 1e-3);                                        // far corner is ~empty
  });
  it("two categories keep separate dominance regions", () => {
    const g = computeDensityGrid(new Float32Array([0.2, 0.8]), new Float32Array([0.5, 0.5]), new Uint16Array([1, 2]), { width: 64, height: 32, x0: 0, x1: 1, y0: 0, y1: 1 }, 5);
    expect(g.bestCat[16 * 64 + 12]).toBe(1); expect(g.bestCat[16 * 64 + 52]).toBe(2);
  });
});
describe("marching squares", () => {
  it("extracts closed-ish contour segments around a radial bump, all inside the grid", () => {
    const w = 40, h = 40, D = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) D[y * w + x] = Math.exp(-((x - 20) ** 2 + (y - 20) ** 2) / 50);
    const segs = marchingSquares(D, w, h, 0.5);
    expect(segs.length).toBeGreaterThan(20);
    for (const s of segs) for (const v of s) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(40); }
    const r = segs.map((s) => Math.hypot(s[0] - 20, s[1] - 20)); const mean = r.reduce((a, b) => a + b, 0) / r.length;
    expect(mean).toBeCloseTo(Math.sqrt(50 * Math.log(2)), 0);                           // radius where exp(-r²/50) = 0.5
  });
  it("returns nothing when the iso level is above the field", () => { expect(marchingSquares(new Float32Array(16), 4, 4, 0.5)).toEqual([]); });
});
describe("bands", () => {
  it("bandLevels are increasing fractions of max; bandOf counts levels below the value", () => {
    const lv = bandLevels(10); expect(lv.length).toBe(6); for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeGreaterThan(lv[i - 1]); expect(lv[lv.length - 1]).toBeLessThan(10);
    expect(bandOf(0, lv)).toBe(0); expect(bandOf(10, lv)).toBe(6); expect(bandOf(lv[2] + 1e-6, lv)).toBe(3);
  });
});

import { tileSegments } from "@/app/canvas/render/contours";
describe("tileSegments", () => {
  it("buckets segments into grid tiles so only visible tiles are stroked", () => {
    const segs: [number, number, number, number][] = [[1, 1, 2, 2], [70, 70, 71, 71], [63, 1, 65, 1]];
    const tiles = tileSegments(segs, 128, 128, 64);
    expect(tiles.get("0,0")!.length).toBe(1); expect(tiles.get("1,1")!.length).toBe(1); expect(tiles.get("0,0")!.length + (tiles.get("1,0")?.length ?? 0)).toBe(2);   // the straddling segment lands in exactly one tile (by midpoint)
  });
});
