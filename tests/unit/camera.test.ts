import { describe, it, expect } from "vitest";
import { project, unproject, zoomAt, fitCamera, type Camera } from "@/app/canvas/render/camera";
const cam: Camera = { x: 10, y: 20, scale: 50 };   // data (10,20) at the viewport centre; 50 px per data unit; y up
const vp = { w: 800, h: 600 };
describe("camera", () => {
  it("projects the camera centre to the viewport centre, y up", () => {
    expect(project(cam, vp, 10, 20)).toEqual({ x: 400, y: 300 });
    expect(project(cam, vp, 11, 21)).toEqual({ x: 450, y: 250 });
  });
  it("unproject inverts project", () => { const d = unproject(cam, vp, 450, 250); expect(d.x).toBeCloseTo(11); expect(d.y).toBeCloseTo(21); });
  it("zoomAt keeps the data point under the cursor fixed", () => {
    const c2 = zoomAt(cam, vp, 450, 250, 2); expect(c2.scale).toBe(100); const p = project(c2, vp, 11, 21); expect(p.x).toBeCloseTo(450); expect(p.y).toBeCloseTo(250);
  });
  it("fitCamera frames the extent with padding", () => {
    const c = fitCamera(new Float32Array([0, 10]), new Float32Array([0, 5]), vp, 0.9);
    expect(c.x).toBe(5); expect(c.y).toBe(2.5); expect(c.scale).toBeCloseTo((800 * 0.9) / 10, 6);
  });
});

import { clampScale } from "@/app/canvas/render/camera";
describe("clampScale", () => {
  it("bounds zoom relative to the fitted scale: 0.25× … 80×", () => {
    expect(clampScale(1, 10)).toBe(2.5); expect(clampScale(5000, 10)).toBe(800); expect(clampScale(100, 10)).toBe(100);
  });
});
