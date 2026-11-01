import { describe, it, expect } from "vitest";
import { initialViewState, toViewState, toViewport } from "@/app/canvas/fallbackView";
describe("fallback view fitting", () => {
  it("targets the centre of the data in the SAME coordinate space the layers draw in (no hidden y flip)", () => {
    const x = new Float32Array([1, 9]), y = new Float32Array([4, 10]);
    const v = initialViewState(x, y, 600);
    expect(v.target).toEqual([5, 7, 0]); expect(v.zoom).toBeCloseTo(Math.log2(600 / 8), 5);
  });
  it("converts Embedding Atlas scale (data units → [-1,1]) to deck zoom (log2 px/unit) using the host size, and back", () => {
    // EA: pixels per unit = scale * max(w,h)/2. With w=1200,h=800 and scale 6 → 3600 px/unit → zoom log2(3600).
    const vs = toViewState({ x: 5, y: 7, scale: 6 }, 1200, 800);
    expect(vs.target).toEqual([5, 7, 0]); expect(vs.zoom).toBeCloseTo(Math.log2(3600), 6);
    const back = toViewport(vs, 1200, 800); expect(back.x).toBe(5); expect(back.y).toBe(7); expect(back.scale).toBeCloseTo(6, 6);
  });
});
