import { chooseSigma, densityField } from "./kde";
import { isolines, isobands, type Ring } from "./isobands";
import { smoothRing } from "./smooth";
import { appendBand, appendRingLines, finalize, newAccumulator } from "./mesh";
import { LEVELS, SIGMA_CELLS, type TerrainInput, type TerrainMesh } from "./types";

/** Deterministic terrain for one set of positions: per cluster category (≥ 3 points, category 0 = unclustered is skipped) a Gaussian KDE → six nested isobands → smoothed rings → triangles + line segments, all in data units. */
export function buildTerrain(input: TerrainInput): TerrainMesh {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { x, y, cat, catRGB } = input; const levels = input.levels ?? LEVELS;
  const sigma = input.sigmaUnits ?? (x.length >= 2 ? chooseSigma(x, y) : 1); const cellsPerUnit = SIGMA_CELLS / sigma;
  const rows = new Map<number, number[]>(); for (let i = 0; i < x.length; i++) { const c = cat[i]; if (c === 0) continue; let arr = rows.get(c); if (!arr) rows.set(c, (arr = [])); arr.push(i); }
  const acc = newAccumulator(); let categories = 0;
  for (const [c, idx] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (idx.length < 3) continue; const rgb = catRGB[c] ?? [200, 200, 200];
    const px = idx.map((i) => x[i]), py = idx.map((i) => y[i]);
    const field = densityField(px, py, cellsPerUnit, SIGMA_CELLS); if (!(field.peak > 0)) continue;
    const bands = isobands(isolines(field, levels.map((f) => f * field.peak))); if (bands.length === 0) continue;
    categories++;
    const cache = new Map<Ring, Ring>(); const sm = (r: Ring) => { let s = cache.get(r); if (!s) { s = smoothRing(r); cache.set(r, s); } return s; };
    const toData = ([cx, cy]: [number, number]): [number, number] => [(cx + field.ox) / cellsPerUnit, (cy + field.oy) / cellsPerUnit];
    const outerRings = new Set<Ring>(); const seen = new Set<Ring>();
    for (const b of bands) {
      const outer = sm(b.outer), holes = b.holes.map(sm); appendBand(acc, { outer, holes, band: b.band }, toData, rgb);
      if (b.band === 1) outerRings.add(outer);
      for (const r of [outer, ...holes]) seen.add(r);
    }
    for (const r of seen) appendRingLines(acc, r, toData, rgb, outerRings.has(r));
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return finalize(acc, { categories, ms: t1 - t0, sigmaUnits: sigma });
}
/** Buffers to transfer (not copy) when posting a mesh from the worker. */
export function transferables(m: TerrainMesh): ArrayBuffer[] { return [m.positions.buffer, m.colors.buffer, m.indices.buffer, m.lines.buffer, m.lineColors.buffer, m.lineWidths.buffer] as ArrayBuffer[]; }
