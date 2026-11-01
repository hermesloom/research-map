import { describe, it, expect } from "vitest";
import { buildTerrain, transferables } from "@/app/canvas/terrain/build";
import type { TerrainInput } from "@/app/canvas/terrain/types";

function gauss(n: number, cx: number, cy: number, sd: number, seed: number) { let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; const x: number[] = [], y: number[] = []; for (let i = 0; i < n; i++) { const u = rnd() || 1e-9, v = rnd(); const r = Math.sqrt(-2 * Math.log(u)); x.push(cx + sd * r * Math.cos(2 * Math.PI * v)); y.push(cy + sd * r * Math.sin(2 * Math.PI * v)); } return { x, y }; }
function twoClusters(): TerrainInput {
  const a = gauss(300, 0, 0, 0.3, 1), b = gauss(300, 4, 1, 0.3, 2);
  return { x: Float32Array.from([...a.x, ...b.x]), y: Float32Array.from([...a.y, ...b.y]), cat: Uint16Array.from([...Array(300).fill(1), ...Array(300).fill(2)]), catRGB: [[200, 200, 200], [255, 0, 0], [0, 0, 255]] };
}
const finite = (a: ArrayLike<number>) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

describe("buildTerrain", () => {
  it("builds nested bands and lines for two clusters, with finite geometry and valid indices", () => {
    const m = buildTerrain(twoClusters());
    expect(m.stats.categories).toBe(2); expect(m.triCount).toBeGreaterThan(50); expect(m.segmentCount).toBeGreaterThan(50);
    expect(finite(m.positions)).toBe(true); expect(finite(m.lines)).toBe(true); const nv = m.positions.length / 2; for (let i = 0; i < m.indices.length; i++) expect(m.indices[i]).toBeLessThan(nv);
    // red vertices only near the red cluster, blue near the blue one
    for (let v = 0; v < nv; v++) { const red = m.colors[4 * v] > 0; if (red) expect(m.positions[2 * v]).toBeLessThan(2.5); else expect(m.positions[2 * v]).toBeGreaterThan(1.5); }
  });
  it("is deterministic", () => { const a = buildTerrain(twoClusters()), b = buildTerrain(twoClusters()); expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true); expect(a.indices).toEqual(b.indices); });
  it("skips category 0 and categories with fewer than 3 points; empty input gives an empty mesh", () => {
    const m = buildTerrain({ x: Float32Array.from([0, 1, 2, 3, 4]), y: new Float32Array(5), cat: Uint16Array.from([0, 0, 0, 1, 1]), catRGB: [[1, 1, 1], [2, 2, 2]] });
    expect(m.triCount).toBe(0); expect(m.stats.categories).toBe(0);
    const e = buildTerrain({ x: new Float32Array(0), y: new Float32Array(0), cat: new Uint16Array(0), catRGB: [] }); expect(e.triCount).toBe(0); expect(e.segmentCount).toBe(0);
  });
  it("degenerate categories (coincident or collinear points) never throw and stay finite", () => {
    const m = buildTerrain({ x: Float32Array.from([1, 1, 1, 0, 1, 2, 3]), y: Float32Array.from([1, 1, 1, 0, 0, 0, 0]), cat: Uint16Array.from([1, 1, 1, 2, 2, 2, 2]), catRGB: [[0, 0, 0], [9, 9, 9], [8, 8, 8]] });
    expect(finite(m.positions)).toBe(true); expect(finite(m.lines)).toBe(true); expect(m.stats.categories).toBe(2);
  });
  it("transferables lists every buffer once", () => { const m = buildTerrain(twoClusters()); const t = transferables(m); expect(t.length).toBe(6); expect(new Set(t).size).toBe(6); });
  it("stays within budget for 1,300 points in 50 categories (soft)", () => {
    const xs: number[] = [], ys: number[] = [], cs: number[] = []; const rgb: [number, number, number][] = [[0, 0, 0]];
    for (let c = 1; c <= 50; c++) { const g = gauss(26, (c % 10) * 0.8, Math.floor(c / 10) * 1.2, 0.18, c); xs.push(...g.x); ys.push(...g.y); cs.push(...Array(26).fill(c)); rgb.push([c, c, c]); }
    const t0 = performance.now(); const m = buildTerrain({ x: Float32Array.from(xs), y: Float32Array.from(ys), cat: Uint16Array.from(cs), catRGB: rgb }); const ms = performance.now() - t0;
    console.log(`terrain 1300/50: ${ms.toFixed(0)} ms, ${m.triCount} tris, ${m.segmentCount} segs, sigma ${m.stats.sigmaUnits.toFixed(3)}`);
    expect(m.stats.categories).toBe(50); expect(ms).toBeLessThan(5000);
  });
});
