import { describe, it, expect } from "vitest";
import { densityField } from "@/app/canvas/terrain/kde";
import { isolines, isobands, ringArea, pointInRing, type Ring } from "@/app/canvas/terrain/isobands";
import { LEVELS } from "@/app/canvas/terrain/types";

const gaussian = () => densityField([5], [5], 10, 8);
describe("isolines", () => {
  it("returns one polygon per level for a single Gaussian, nested and shrinking", () => {
    const f = gaussian(); const per = isolines(f, LEVELS.map((l) => l * f.peak));
    expect(per.length).toBe(6); for (const polys of per) expect(polys.length).toBe(1);
    const areas = per.map((polys) => Math.abs(ringArea(polys[0][0]))); for (let i = 1; i < 6; i++) expect(areas[i]).toBeLessThan(areas[i - 1]);
    expect(pointInRing([per[0][0][0][0][0], per[0][0][0][0][1]], per[0][0][0])).toBe(false);   // a vertex is on, not strictly inside
    const cx = 50 - f.ox, cy = 50 - f.oy; expect(pointInRing([cx, cy], per[5][0][0])).toBe(true);
  });
});
describe("isobands", () => {
  it("band i keeps level i's polygon with level i+1's exterior as a hole; the innermost band has none", () => {
    const f = gaussian(); const bands = isobands(isolines(f, LEVELS.map((l) => l * f.peak)));
    expect(bands.map((b) => b.band)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < 5; i++) expect(bands[i].holes.length).toBe(1); expect(bands[5].holes.length).toBe(0);
    expect(bands[0].holes[0]).toBe(bands[1].outer);   // the same ring object is shared, so smoothing it once keeps the boundary identical
  });
  it("drops polygons smaller than the minimum area", () => {
    const tiny: Ring = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]];
    expect(isobands([[[tiny]]], 4)).toEqual([]);
  });
});
describe("ringArea", () => { it("is positive for counter-clockwise rings in a y-up frame", () => { expect(ringArea([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBeCloseTo(1, 9); }); });
