import { chooseSigma, densityField, type Field } from "./kde";
import { isolines, isobands, type Ring } from "./isobands";
import { smoothRing, smoothOpen, splitRing, canonicalArc } from "./smooth";
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
/** Strictly increasing levels: equal thresholds (plateaus, coarse grids) would stack the same region twice. */
export function dedupeLevels(levels: number[]): number[] { const out: number[] = []; for (const L of levels) if (out.length === 0 || L > out[out.length - 1]) out.push(L); return out; }

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
  const levelsAbs = dedupeLevels(hdrLevels(total, input.levels ?? MASS_LEVELS)); let categories = 0;
  // seam arcs shared between two regions, keyed by their endpoints in global grid coordinates (per build)
  const seamCache = new Map<string, Ring>();
  const seamKey = (can: Ring, ox: number, oy: number) => { const p = can[0], q = can[can.length - 1]; return `${(p[0] + ox).toFixed(4)},${(p[1] + oy).toFixed(4)}|${(q[0] + ox).toFixed(4)},${(q[1] + oy).toFixed(4)}|${can.length}`; };
  // pass 2: per category, the zero isoline of min(total − L, f_c − strongest other) per level, on a window cropped to the category's dominance region
  for (const [c, idx] of used) {
    const f = densityField(idx.map((i) => x[i]), idx.map((i) => y[i]), cpu, SIGMA_CELLS);
    // dominance window: cells where f_c beats every other category, padded by 2 cells
    let wx0 = f.n, wx1 = -1, wy0 = f.m, wy1 = -1;
    for (let j = 0; j < f.m; j++) { const gy = j + f.oy - gy0; if (gy < 0 || gy >= H) continue; for (let i = 0; i < f.n; i++) { const gx = i + f.ox - gx0; if (gx < 0 || gx >= W) continue; const g = gy * W + gx; if (best1c[g] === c && f.values[j * f.n + i] > 0) { if (i < wx0) wx0 = i; if (i > wx1) wx1 = i; if (j < wy0) wy0 = j; if (j > wy1) wy1 = j; } } }
    if (wx1 < 0) continue;
    wx0 = Math.max(0, wx0 - 2); wy0 = Math.max(0, wy0 - 2); wx1 = Math.min(f.n - 1, wx1 + 2); wy1 = Math.min(f.m - 1, wy1 + 2);
    const n = wx1 - wx0 + 1, mh = wy1 - wy0 + 1; const m = new Float32Array(n * mh); const mf: Field = { values: m, n, m: mh, ox: f.ox + wx0, oy: f.oy + wy0, peak: 1 };
    // per window cell: h = f_c − strongest other (the dominance term) and the global index (−1 outside the grid)
    const hWin = new Float32Array(n * mh), gWin = new Int32Array(n * mh);
    for (let j = 0; j < mh; j++) { const fj = j + wy0; const gy = fj + f.oy - gy0; for (let i = 0; i < n; i++) { const fi = i + wx0; const gx = fi + f.ox - gx0; const k = j * n + i; if (gy < 0 || gy >= H || gx < 0 || gx >= W) { gWin[k] = -1; hWin[k] = -1; continue; } const g = gy * W + gx; gWin[k] = g; hWin[k] = f.values[fj * f.n + fi] - (best1c[g] === c ? best2v[g] : best1v[g]); } }
    const perLevel: Ring[][][] = [];
    for (const L of levelsAbs) {
      let any = false;
      for (let k = 0; k < m.length; k++) { const g = gWin[k]; if (g < 0) { m[k] = -1; continue; } const v = Math.min(total[g] - L, hWin[k]); m[k] = v; if (v >= 0) any = true; }
      if (!any) break;   // higher levels are empty too
      perLevel.push(isolines(mf, [0])[0]);
    }
    // a ring edge is a density boundary (stroke it) when total − L is the active term at its midpoint, and a category seam (no stroke) when the dominance term is
    const densityEdge = (L: number) => (p: [number, number], q: [number, number]) => { const i = Math.min(n - 1, Math.max(0, Math.floor((p[0] + q[0]) / 2))), j = Math.min(mh - 1, Math.max(0, Math.floor((p[1] + q[1]) / 2))); const k = j * n + i; const g = gWin[k]; if (g < 0) return false; return total[g] - L <= hWin[k]; };
    const bands = isobands(perLevel, 4, false); if (bands.length === 0) continue; categories++;   // cumulative: level ≥ b regions stacked with incremental alphas
    const rgb = catRGB[c] ?? [200, 200, 200];
    // window → data; the shift of 0.5 is because d3 places sample i at grid coordinate i + 0.5
    const toData = ([cx, cy]: [number, number]): [number, number] => [(cx + mf.ox - 0.5) / cpu, (cy + mf.oy - 0.5) / cpu];
    for (const b of bands) {
      const L = levelsAbs[b.band - 1]; const isDensity = densityEdge(L); const densityArcs: Ring[] = [];
      // each ring is split at the junctions between density boundary and category seam; seam arcs are smoothed in canonical orientation and
      // cached in global coordinates, so the neighbouring region (built later) reuses the identical polyline → no gaps, no overlaps
      const smoothPieces = (ring: Ring): Ring => {
        const arcs = splitRing(ring, isDensity); if (arcs.length === 1 && arcs[0].closed) { const r = smoothRing(ring); if (arcs[0].density) densityArcs.push(r); return r; }
        const out: Ring = [];
        for (const a of arcs) {
          let pts: Ring;
          if (a.density) { pts = smoothOpen(a.pts); densityArcs.push(pts); }
          else { const can = canonicalArc(a.pts); const key = seamKey(can, mf.ox, mf.oy); let sm = seamCache.get(key); if (!sm) { sm = smoothOpen(can).map(([x, y]) => [x + mf.ox, y + mf.oy] as [number, number]); seamCache.set(key, sm); } pts = sm.map(([x, y]) => [x - mf.ox, y - mf.oy] as [number, number]); if (can !== a.pts) pts = [...pts].reverse(); }
          for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i]);
        }
        if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
        return out;
      };
      const outer = smoothPieces(b.outer), holes = b.holes.map(smoothPieces); appendBand(acc, { outer, holes, band: b.band }, toData, rgb, BAND_ALPHA_INCREMENT(b.band));
      for (const r of densityArcs) appendRingLines(acc, r, toData, rgb, b.band === 1);
    }
  }
  return finalize(acc, { categories, ms: now() - t0, sigmaUnits: sigma });
}
/** Buffers to transfer (not copy) when posting a mesh from the worker. */
export function transferables(m: TerrainMesh): ArrayBuffer[] { return [m.positions.buffer, m.colors.buffer, m.indices.buffer, m.lines.buffer, m.lineColors.buffer, m.lineWidths.buffer] as ArrayBuffer[]; }
