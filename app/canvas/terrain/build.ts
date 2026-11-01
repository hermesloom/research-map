import { chooseSigma, densityField, type Field } from "./kde";
import { isolines, isobands, type Ring } from "./isobands";
import { smoothRing } from "./smooth";
import { appendBand, appendRingLines, finalize, newAccumulator } from "./mesh";
import { LEVELS, SIGMA_CELLS, type TerrainInput, type TerrainMesh } from "./types";

const MAX_CELLS = 4_000_000;

/**
 * Deterministic terrain for one set of positions, as an exact vector tiling:
 * bands of the TOTAL density (six levels, fractions of its peak) split along the curves where one category's density
 * overtakes every other's. Band (c, L) = { total ≥ L } ∩ { f_c > max_{c'≠c} f_c' }, traced as the zero isoline of
 * min(total − L, f_c − other). Neighbouring regions share identical boundaries (h_c = −h_c'), so nothing overlaps or gaps.
 * Category 0 (unclustered) and categories with < 3 points get no terrain.
 */
export function buildTerrain(input: TerrainInput): TerrainMesh {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()); const t0 = now();
  const { x, y, cat, catRGB } = input; const levels = input.levels ?? LEVELS;
  const rows = new Map<number, number[]>(); for (let i = 0; i < x.length; i++) { const c = cat[i]; if (c === 0) continue; let arr = rows.get(c); if (!arr) rows.set(c, (arr = [])); arr.push(i); }
  const cats = [...rows.entries()].filter(([, idx]) => idx.length >= 3).sort((a, b) => a[0] - b[0]);
  const acc = newAccumulator();
  if (cats.length === 0 || x.length < 2) return finalize(acc, { categories: 0, ms: now() - t0, sigmaUnits: input.sigmaUnits ?? 1 });
  let sigma = input.sigmaUnits ?? chooseSigma(x, y); let cpu = SIGMA_CELLS / sigma;
  // global grid covering every point, padded by 3σ (cap the cell count by coarsening σ)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < x.length; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
  const pad = Math.ceil(3 * SIGMA_CELLS); let gx0 = Math.floor(x0 * cpu) - pad, gy0 = Math.floor(y0 * cpu) - pad, W = Math.ceil(x1 * cpu) - gx0 + pad + 2, H = Math.ceil(y1 * cpu) - gy0 + pad + 2;
  if (W * H > MAX_CELLS) { const k = Math.sqrt((W * H) / MAX_CELLS); sigma *= k; cpu = SIGMA_CELLS / sigma; gx0 = Math.floor(x0 * cpu) - pad; gy0 = Math.floor(y0 * cpu) - pad; W = Math.ceil(x1 * cpu) - gx0 + pad + 2; H = Math.ceil(y1 * cpu) - gy0 + pad + 2; }
  const total = new Float32Array(W * H), best1v = new Float32Array(W * H), best2v = new Float32Array(W * H), best1c = new Int32Array(W * H).fill(-1);
  // pass 1: per-category fields on their own sub-grids; accumulate total and the two strongest categories per cell
  const fields: { c: number; f: Field }[] = [];
  for (const [c, idx] of cats) {
    const f = densityField(idx.map((i) => x[i]), idx.map((i) => y[i]), cpu, SIGMA_CELLS); if (!(f.peak > 0)) continue; fields.push({ c, f });
    for (let j = 0; j < f.m; j++) { const gy = j + f.oy - gy0; if (gy < 0 || gy >= H) continue; for (let i = 0; i < f.n; i++) { const gx = i + f.ox - gx0; if (gx < 0 || gx >= W) continue; const v = f.values[j * f.n + i]; if (v <= 0) continue; const g = gy * W + gx; total[g] += v; if (v > best1v[g]) { best2v[g] = best1v[g]; best1v[g] = v; best1c[g] = c; } else if (v > best2v[g]) best2v[g] = v; } }
  }
  let peak = 0; for (let g = 0; g < total.length; g++) if (total[g] > peak) peak = total[g];
  const levelsAbs = levels.map((fr) => fr * peak); let categories = 0;
  // pass 2: per category, per level, the zero isoline of min(total − L, f_c − strongest other)
  for (const { c, f } of fields) {
    const m = new Float32Array(f.n * f.m); const mf: Field = { values: m, n: f.n, m: f.m, ox: f.ox, oy: f.oy, peak: 1 };
    const perLevel: Ring[][][] = levelsAbs.map((L) => {
      for (let j = 0; j < f.m; j++) { const gy = j + f.oy - gy0; for (let i = 0; i < f.n; i++) { const k = j * f.n + i; const gx = i + f.ox - gx0; if (gy < 0 || gy >= H || gx < 0 || gx >= W) { m[k] = -1; continue; } const g = gy * W + gx; const other = best1c[g] === c ? best2v[g] : best1v[g]; m[k] = Math.min(total[g] - L, f.values[k] - other); } }
      return isolines(mf, [0])[0];
    });
    const bands = isobands(perLevel); if (bands.length === 0) continue; categories++;
    const rgb = catRGB[c] ?? [200, 200, 200]; const cache = new Map<Ring, Ring>(); const sm = (r: Ring) => { let s = cache.get(r); if (!s) { s = smoothRing(r); cache.set(r, s); } return s; };
    const toData = ([cx, cy]: [number, number]): [number, number] => [(cx + f.ox) / cpu, (cy + f.oy) / cpu];
    const outerRings = new Set<Ring>(), seen = new Set<Ring>();
    for (const b of bands) { const outer = sm(b.outer), holes = b.holes.map(sm); appendBand(acc, { outer, holes, band: b.band }, toData, rgb); if (b.band === 1) outerRings.add(outer); for (const r of [outer, ...holes]) seen.add(r); }
    for (const r of seen) appendRingLines(acc, r, toData, rgb, outerRings.has(r));
  }
  return finalize(acc, { categories, ms: now() - t0, sigmaUnits: sigma });
}
/** Buffers to transfer (not copy) when posting a mesh from the worker. */
export function transferables(m: TerrainMesh): ArrayBuffer[] { return [m.positions.buffer, m.colors.buffer, m.indices.buffer, m.lines.buffer, m.lineColors.buffer, m.lineWidths.buffer] as ArrayBuffer[]; }
