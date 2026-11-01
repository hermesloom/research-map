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

import { renderBandImage } from "@/app/canvas/render/contours";
describe("renderBandImage", () => {
  it("samples the field bilinearly at screen resolution: coloured where dense, transparent where empty", () => {
    const g = computeDensityGrid(new Float32Array([0.5]), new Float32Array([0.5]), new Uint16Array([1]), { width: 32, height: 32, x0: 0, x1: 1, y0: 0, y1: 1 }, 3);
    const levels = bandLevels(g.max); const rgb: [number, number, number][] = [[200, 200, 200], [255, 0, 0]];
    // region covering grid cells [8,24) in both axes, drawn at 4 px per cell → 64×64 image
    const img = renderBandImage(g, levels, rgb, { gx0: 8, gy0: 8, cellsPerPx: 0.25 }, 64, 64);
    const at = (x: number, y: number) => Array.from(img.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    const c = at(32, 32); expect(c[0]).toBe(255); expect(c[3]).toBeGreaterThan(40);          // centre: red, visible
    expect(at(1, 1)[3]).toBe(0);                                                             // corner: transparent
    expect(at(32, 32)[3]).toBeGreaterThan(at(32, 20)[3]);                                    // alpha grows toward the peak
  });
});

import { categoryAt } from "@/app/canvas/render/contours";
describe("smooth per-category fields", () => {
  it("categoryAt interpolates each category's own density between cells, so the boundary between two clusters is the smooth crossing of their fields", () => {
    const spec = { width: 64, height: 32, x0: 0, x1: 2, y0: 0, y1: 1 };
    // cluster 1 is denser (two points) than cluster 2 (one point): the boundary must sit right of the midpoint (x = 32 cells)
    const g = computeDensityGrid(new Float32Array([0.5, 0.55, 1.5]), new Float32Array([0.5, 0.5, 0.5]), new Uint16Array([1, 1, 2]), spec, 10);
    expect(categoryAt(g, 10, 16)).toBe(1); expect(categoryAt(g, 54, 16)).toBe(2);
    let boundary = -1; for (let x = 20; x < 60; x++) if (categoryAt(g, x + 0.5, 16) === 2) { boundary = x; break; }
    expect(boundary).toBeGreaterThan(32); expect(boundary).toBeLessThan(50);
    // sub-cell smoothness: sampling at quarter-cell offsets around the boundary changes category exactly once
    const seq: number[] = []; for (let x = boundary - 2; x <= boundary + 2; x += 0.25) seq.push(categoryAt(g, x, 16)); expect(seq.filter((c, i) => i > 0 && c !== seq[i - 1]).length).toBe(1);
  });
  it("renderBandImage uses categoryAt by default", () => {
    const spec = { width: 64, height: 32, x0: 0, x1: 2, y0: 0, y1: 1 };
    const g = computeDensityGrid(new Float32Array([0.5, 1.5]), new Float32Array([0.5, 0.5]), new Uint16Array([1, 2]), spec, 10);
    const img = renderBandImage(g, bandLevels(g.max), [[0, 0, 0], [255, 0, 0], [0, 0, 255]], { gx0: 0, gy0: 0, cellsPerPx: 0.5 }, 128, 64);
    const px = (i: number, j: number) => Array.from(img.subarray((j * 128 + i) * 4, (j * 128 + i) * 4 + 3));
    expect(px(56, 32)).toEqual([255, 0, 0]); expect(px(72, 32)).toEqual([0, 0, 255]);
  });
});
