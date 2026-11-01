import { describe, it, expect } from "vitest";
import { initialViewState, toViewport } from "@/app/canvas/fallbackView";
describe("fallback view fitting", () => {
  it("targets the centre of the data in the SAME coordinate space the layers draw in (no hidden y flip)", () => {
    const x = new Float32Array([1, 9]), y = new Float32Array([4, 10]);                 // live data lives at positive y
    const v = initialViewState(x, y, 600);
    expect(v.target).toEqual([5, 7, 0]);                                               // not [5, -7, 0]
    expect(v.zoom).toBeCloseTo(Math.log2(600 / 8), 5);                                 // fits the larger span (x: 8, y: 6)
  });
  it("round-trips viewport <-> view state without changing sign", () => {
    const vs = toViewport({ target: [5, 7, 0], zoom: 3 }); expect(vs).toEqual({ x: 5, y: 7, scale: 8 });
  });
});
