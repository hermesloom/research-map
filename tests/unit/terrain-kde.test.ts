import { describe, it, expect } from "vitest";
import { medianNN, chooseSigma, densityField } from "@/app/canvas/terrain/kde";

describe("medianNN", () => {
  it("is the median nearest-neighbour distance (unit grid → 1)", () => {
    const x: number[] = [], y: number[] = []; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { x.push(i); y.push(j); }
    expect(medianNN(x, y)).toBeCloseTo(1, 6);
  });
  it("returns 1 for fewer than two points", () => { expect(medianNN([0], [0])).toBe(1); });
});

describe("chooseSigma", () => {
  it("is 2.5 × median NN spacing, capped at 8 % and floored at 0.5 % of the larger bbox side", () => {
    const x: number[] = [], y: number[] = []; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { x.push(i * 0.1); y.push(j * 0.1); }   // extent 0.9, NN 0.1 → 0.25 caps at 0.072
    expect(chooseSigma(x, y)).toBeCloseTo(0.08 * 0.9, 6);
    const far = [0, 10, 20, 30], fy = [0, 0, 0, 0];                       // NN 10 → 25 caps at 0.08·30 = 2.4
    expect(chooseSigma(far, fy)).toBeCloseTo(2.4, 6);
    const dense = [0, 0.001, 5], dy = [0, 0, 0];                           // NN 0.001 → 0.0025 floors at 0.005·5 = 0.025
    expect(chooseSigma(dense, dy)).toBeCloseTo(0.025, 6);
    const strip: number[] = [], sy: number[] = []; for (let i = 0; i < 200; i++) { strip.push(i * 0.12); sy.push(0); }   // 24 wide, flat: NN 0.12 → 0.3, not inflated by the width
    expect(chooseSigma(strip, sy)).toBeCloseTo(0.3, 2);
  });
});

describe("densityField", () => {
  it("conserves mass, peaks at the point, and falls to e^-0.5 of the peak one sigma away", () => {
    const f = densityField([3], [2], 10, 8);                              // 10 cells per unit, σ = 8 cells
    let sum = 0, imax = 0; for (let k = 0; k < f.values.length; k++) { sum += f.values[k]; if (f.values[k] > f.values[imax]) imax = k; }
    expect(sum).toBeCloseTo(1, 2);
    const cx = imax % f.n, cy = Math.floor(imax / f.n);
    expect(cx + f.ox).toBeCloseTo(30, 0); expect(cy + f.oy).toBeCloseTo(20, 0);   // peak cell at the point (data 3,2 → 30,20 cells)
    const atSigma = f.values[cy * f.n + cx + 8] / f.peak; expect(Math.abs(atSigma - Math.exp(-0.5))).toBeLessThan(0.1);
  });
  it("pads the sub-grid by three sigma around the points' bounding box", () => {
    const f = densityField([0, 1], [0, 0], 10, 4);
    expect(f.ox).toBe(-12); expect(f.n).toBeGreaterThanOrEqual(10 + 24 + 1);
  });
});
