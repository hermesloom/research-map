import { describe, it, expect } from "vitest";
import { rasterSpec, medianSpacing } from "@/app/canvas/render/density";
describe("density raster", () => {
  it("rasterSpec maps the data extent to a square-ish raster with margin", () => {
    const s = rasterSpec(new Float32Array([0, 10]), new Float32Array([0, 5]), 1024);
    expect(s.width).toBe(1024); expect(s.height).toBeGreaterThan(400); expect(s.height).toBeLessThanOrEqual(1024);
    const p = s.toPixel(0, 0), q = s.toPixel(10, 5); expect(p.x).toBeLessThan(q.x); expect(p.y).toBeGreaterThan(q.y);   // y up in data, down in raster
    expect(p.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(1024);
  });
  it("medianSpacing of a unit grid is 1", () => { const xs: number[] = [], ys: number[] = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { xs.push(i); ys.push(j); } expect(medianSpacing(xs, ys)).toBeCloseTo(1, 6); });
});
