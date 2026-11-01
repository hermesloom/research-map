import { chooseSigma, densityField, type Field } from "./kde";
import { isolines, isobands, type Ring } from "./isobands";
import { smoothRing } from "./smooth";
import { appendBand, appendRingLines, finalize, newAccumulator } from "./mesh";
import { BAND_ALPHA_INCREMENT, SIGMA_CELLS, type TerrainInput, type TerrainMesh } from "./types";

const MAX_CELLS = 600_000;   // ≈ the 1024-px raster the accepted renderer used; σ is coarsened to respect it
/** Highest-density-region thresholds: for each mass fraction q, the density above which the cells hold q of the total mass
 *  (estimated on a stride sample of the non-empty cells). Robust to a single extreme spike, and for one Gaussian blob the
 *  fractions [0.94, 0.86, 0.74, 0.58, 0.38, 0.15] reproduce the classic fraction-of-peak levels [0.06 … 0.85]. */
export function hdrLevels(total: Float32Array, massFractions: number[], maxSamples = 262144): number[] {
  const stride = Math.max(1, Math.ceil(total.length / maxSamples)); let n = 0; for (let g = 0; g < total.length; g += stride) if (total[g] > 0) n++;
  if (n === 0) return massFractions.map(() => Infinity);
  const vals = new Float32Array(n); let k = 0, sum = 0; for (let g = 0; g < total.length; g += stride) if (total[g] > 0) { vals[k++] = total[g]; sum += total[g]; }
  vals.sort(); const out: number[] = []; let i = n - 1, acc = 0; const targets = massFractions.map((q) => q * sum);
  // walk from the densest cell down; level q = density at which the accumulated mass first reaches q·sum
  const res = new Array<number>(massFractions.length).fill(vals[0]); const order = targets.map((t, j) => [t, j] as const).sort((p, r) => p[0] - r[0]); let oi = 0;
  while (i >= 0 && oi < order.length) { acc += vals[i]; while (oi < order.length && acc >= order[oi][0]) { res[order[oi][1]] = vals[i]; oi++; } i--; }
  for (let j = 0; j < res.length; j++) out.push(res[j]); return out;
}
export const MASS_LEVELS = [0.94, 0.86, 0.74, 0.58, 0.38, 0.15];

/**
 * Deterministic terrain for one set of positions, as an exact vector tiling:
 * bands of the TOTAL density (six levels, fractions of its peak) split along the curves where one category's density
 * overtakes every other's. Region (c, L) = { total ≥ L } ∩ { f_c > max_{c'≠c} f_c' }, traced as the zero isoline of
 * min(total − L, f_c − other). Neighbouring regions share identical boundaries (h_c = −h_c'), so nothing overlaps or gaps.
 * Regions of successive levels are stacked (drawn over each other with incremental alphas) rather than cut into rings, so
 * no ring ever has to serve as another ring's hole; the triangulation stays artefact-free.
 * Category 0 (unclustered) and categories with < 3 points get no terrain.
 */
export function buildTerrain(input: TerrainInput): TerrainMesh {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()); const t0 = now();
  const { x, y, cat, catRGB } = input;
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
  // pass 1: per-category fields on their own sub-grids; accumulate total and the two strongest categories per cell (fields are recomputed in pass 2 instead of being kept: 40 full-width fields would not fit on a phone)
  const used: [number, number[]][] = [];
  for (const [c, idx] of cats) {
    const f = densityField(idx.map((i) => x[i]), idx.map((i) => y[i]), cpu, SIGMA_CELLS); if (!(f.peak > 0)) continue; used.push([c, idx]);
    for (let j = 0; j < f.m; j++) { const gy = j + f.oy - gy0; if (gy < 0 || gy >= H) continue; for (let i = 0; i < f.n; i++) { const gx = i + f.ox - gx0; if (gx < 0 || gx >= W) continue; const v = f.values[j * f.n + i]; if (v <= 0) continue; const g = gy * W + gx; total[g] += v; if (v > best1v[g]) { best2v[g] = best1v[g]; best1v[g] = v; best1c[g] = c; } else if (v > best2v[g]) best2v[g] = v; } }
  }
  // levels by enclosed mass (highest-density regions), so one extreme spike (e.g. the convergence at the centre of the question lens) cannot push every other region below the lowest level
  const levelsAbs = hdrLevels(total, input.levels ?? MASS_LEVELS); let categories = 0;
  // pass 2: per category, the zero isoline of min(total − L, f_c − strongest other) per level, on a window cropped to the category's dominance region
  for (const [c, idx] of used) {
    const f = densityField(idx.map((i) => x[i]), idx.map((i) => y[i]), cpu, SIGMA_CELLS);
    // dominance window: cells where f_c beats every other category, padded by 2 cells
    let wx0 = f.n, wx1 = -1, wy0 = f.m, wy1 = -1;
    for (let j = 0; j < f.m; j++) { const gy = j + f.oy - gy0; if (gy < 0 || gy >= H) continue; for (let i = 0; i < f.n; i++) { const gx = i + f.ox - gx0; if (gx < 0 || gx >= W) continue; const g = gy * W + gx; if (best1c[g] === c && f.values[j * f.n + i] > 0) { if (i < wx0) wx0 = i; if (i > wx1) wx1 = i; if (j < wy0) wy0 = j; if (j > wy1) wy1 = j; } } }
    if (wx1 < 0) continue;
    wx0 = Math.max(0, wx0 - 2); wy0 = Math.max(0, wy0 - 2); wx1 = Math.min(f.n - 1, wx1 + 2); wy1 = Math.min(f.m - 1, wy1 + 2);
    const n = wx1 - wx0 + 1, mh = wy1 - wy0 + 1; const m = new Float32Array(n * mh); const mf: Field = { values: m, n, m: mh, ox: f.ox + wx0, oy: f.oy + wy0, peak: 1 };
    const perLevel: Ring[][][] = [];
    for (const L of levelsAbs) {
      let any = false;
      for (let j = 0; j < mh; j++) { const fj = j + wy0; const gy = fj + f.oy - gy0; for (let i = 0; i < n; i++) { const fi = i + wx0; const gx = fi + f.ox - gx0; const k = j * n + i; if (gy < 0 || gy >= H || gx < 0 || gx >= W) { m[k] = -1; continue; } const g = gy * W + gx; const other = best1c[g] === c ? best2v[g] : best1v[g]; const v = Math.min(total[g] - L, f.values[fj * f.n + fi] - other); m[k] = v; if (v >= 0) any = true; } }
      if (!any) break;   // higher levels are empty too
      perLevel.push(isolines(mf, [0])[0]);
    }
    const bands = isobands(perLevel, 4, false); if (bands.length === 0) continue; categories++;   // cumulative: level ≥ b regions stacked with incremental alphas
    const rgb = catRGB[c] ?? [200, 200, 200]; const cache = new Map<Ring, Ring>(); const sm = (r: Ring) => { let s = cache.get(r); if (!s) { s = smoothRing(r); cache.set(r, s); } return s; };
    const toData = ([cx, cy]: [number, number]): [number, number] => [(cx + mf.ox) / cpu, (cy + mf.oy) / cpu];
    const outerRings = new Set<Ring>(), seen = new Set<Ring>();
    for (const b of bands) { const outer = sm(b.outer), holes = b.holes.map(sm); appendBand(acc, { outer, holes, band: b.band }, toData, rgb, BAND_ALPHA_INCREMENT(b.band)); if (b.band === 1) outerRings.add(outer); for (const r of [outer, ...holes]) seen.add(r); }
    for (const r of seen) appendRingLines(acc, r, toData, rgb, outerRings.has(r));
  }
  return finalize(acc, { categories, ms: now() - t0, sigmaUnits: sigma });
}
/** Buffers to transfer (not copy) when posting a mesh from the worker. */
export function transferables(m: TerrainMesh): ArrayBuffer[] { return [m.positions.buffer, m.colors.buffer, m.indices.buffer, m.lines.buffer, m.lineColors.buffer, m.lineWidths.buffer] as ArrayBuffer[]; }
