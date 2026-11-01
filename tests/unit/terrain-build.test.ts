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

describe("dominance tiling", () => {
  it("two overlapping categories tile the terrain: each region is coloured by the locally dominant category, no band straddles the boundary", () => {
    const a = gauss(300, 0, 0, 0.3, 11), b = gauss(300, 0.6, 0, 0.3, 12);
    const m = buildTerrain({ x: Float32Array.from([...a.x, ...b.x]), y: Float32Array.from([...a.y, ...b.y]), cat: Uint16Array.from([...Array(300).fill(1), ...Array(300).fill(2)]), catRGB: [[0, 0, 0], [255, 0, 0], [0, 0, 255]] });
    expect(m.stats.categories).toBe(2); const nv = m.positions.length / 2; let red = 0, blue = 0;
    // near the axis through both centres the boundary is at x ≈ 0.3 (sampling noise moves it a little; the tails are not checked)
    for (let v = 0; v < nv; v++) { const x = m.positions[2 * v], yv = m.positions[2 * v + 1]; if (Math.abs(yv) > 0.25) continue; if (m.colors[4 * v] > 0) { red++; expect(x).toBeLessThan(0.3 + 0.15); } else { blue++; expect(x).toBeGreaterThan(0.3 - 0.15); } }
    expect(red).toBeGreaterThan(20); expect(blue).toBeGreaterThan(20);
  });
  it("levels are fractions of the global peak of the total density, so a sparse category gets fewer bands than a dense one", () => {
    const a = gauss(400, 0, 0, 0.25, 21), b = gauss(40, 4, 0, 0.25, 22);
    const m = buildTerrain({ x: Float32Array.from([...a.x, ...b.x]), y: Float32Array.from([...a.y, ...b.y]), cat: Uint16Array.from([...Array(400).fill(1), ...Array(40).fill(2)]), catRGB: [[0, 0, 0], [255, 0, 0], [0, 0, 255]] });
    const alphas = (pred: (v: number) => boolean) => { const s = new Set<number>(); for (let v = 0; v < m.positions.length / 2; v++) if (pred(v)) s.add(m.colors[4 * v + 3]); return s.size; };   // distinct incremental alphas = number of levels reached
    expect(alphas((v) => m.colors[4 * v] > 0)).toBeGreaterThan(alphas((v) => m.colors[4 * v + 2] > 0));
  });
});

describe("mass-based levels", () => {
  it("hdrLevels of a single Gaussian field match the classic fraction-of-peak levels within a few percent", async () => {
    const { hdrLevels } = await import("@/app/canvas/terrain/build"); const { densityField } = await import("@/app/canvas/terrain/kde");
    const f = densityField([5], [5], 10, 8); const lv = hdrLevels(f.values, [0.94, 0.86, 0.74, 0.58, 0.38, 0.15]); const classic = [0.06, 0.14, 0.26, 0.42, 0.62, 0.85];
    lv.forEach((L, i) => expect(Math.abs(L / f.peak - classic[i])).toBeLessThan(0.06));
  });
  it("a tiny very dense spike does not erase the bands of a broad category", () => {
    const broad = gauss(400, 0, 0, 0.6, 31); const spike = gauss(200, 5, 0, 0.03, 32);
    const m = buildTerrain({ x: Float32Array.from([...broad.x, ...spike.x]), y: Float32Array.from([...broad.y, ...spike.y]), cat: Uint16Array.from([...Array(400).fill(1), ...Array(200).fill(2)]), catRGB: [[0, 0, 0], [255, 0, 0], [0, 0, 255]] });
    const redAlphas = new Set<number>(); for (let v = 0; v < m.positions.length / 2; v++) if (m.colors[4 * v] > 0) redAlphas.add(m.colors[4 * v + 3]);
    expect(redAlphas.size).toBeGreaterThanOrEqual(3);
  });
});

describe("review fixes", () => {
  it("terrain is not shifted: for a symmetric lattice of points the innermost region is centred on the lattice centre (a half-cell error would show)", () => {
    const xs: number[] = [], ys: number[] = []; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { xs.push(2 + i * 0.1); ys.push(1 + j * 0.1); }
    const m = buildTerrain({ x: Float32Array.from(xs), y: Float32Array.from(ys), cat: Uint16Array.from(Array(25).fill(1)), catRGB: [[0, 0, 0], [255, 0, 0]], sigmaUnits: 0.3 });
    const top = Math.max(...Array.from(m.colors.filter((_, i) => i % 4 === 3))); let sx = 0, sy = 0, A = 0;   // area-weighted centroid of the innermost region's triangles
    for (let t = 0; t < m.indices.length; t += 3) { const [i0, i1, i2] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]; if (m.colors[4 * i0 + 3] !== top) continue; const P = (i: number) => [m.positions[2 * i], m.positions[2 * i + 1]]; const [a, b, c] = [P(i0), P(i1), P(i2)]; const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; sx += (ar * (a[0] + b[0] + c[0])) / 3; sy += (ar * (a[1] + b[1] + c[1])) / 3; A += ar; }
    const cell = 0.3 / 12; expect(A).toBeGreaterThan(0); expect(Math.abs(sx / A - 2)).toBeLessThan(cell * 0.1); expect(Math.abs(sy / A - 1)).toBeLessThan(cell * 0.1);
  });
  it("contour lines follow density levels only: no line segments run along the seam between two touching categories", () => {
    const a = gauss(300, 0, 0, 0.3, 11), b = gauss(300, 0.6, 0, 0.3, 12);
    const m = buildTerrain({ x: Float32Array.from([...a.x, ...b.x]), y: Float32Array.from([...a.y, ...b.y]), cat: Uint16Array.from([...Array(300).fill(1), ...Array(300).fill(2)]), catRGB: [[0, 0, 0], [255, 0, 0], [0, 0, 255]] });
    let onSeam = 0, total = 0;
    for (let s = 0; s < m.segmentCount; s++) { const mx = (m.lines[4 * s] + m.lines[4 * s + 2]) / 2, my = (m.lines[4 * s + 1] + m.lines[4 * s + 3]) / 2; total++; if (Math.abs(mx - 0.3) < 0.03 && Math.abs(my) < 0.15) onSeam++; }
    expect(total).toBeGreaterThan(50); expect(onSeam).toBeLessThan(total * 0.01);
  });
  it("duplicate mass levels are skipped instead of stacking the same region twice", async () => {
    const { dedupeLevels } = await import("@/app/canvas/terrain/build"); expect(dedupeLevels([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });
});
