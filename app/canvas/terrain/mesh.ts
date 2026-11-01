import earcut from "earcut";
import type { BandPolygon, Ring } from "./isobands";
import { BAND_ALPHA, LINE_INNER, LINE_OUTER, type RGB, type TerrainMesh, type TerrainStats } from "./types";

export type MeshAccumulator = { positions: number[]; colors: number[]; indices: number[]; lines: number[]; lineColors: number[]; lineWidths: number[] };
export const newAccumulator = (): MeshAccumulator => ({ positions: [], colors: [], indices: [], lines: [], lineColors: [], lineWidths: [] });
type ToData = (p: [number, number]) => [number, number];

/** Triangulate one band polygon (outer + holes) with earcut and append premultiplied vertex colours at the band's alpha. Degenerate rings are skipped. */
export function appendBand(acc: MeshAccumulator, poly: BandPolygon, toData: ToData, rgb: RGB): void {
  const rings = [poly.outer, ...poly.holes].filter((r) => r.length >= 4);
  if (rings.length === 0 || rings[0] !== poly.outer) return;
  const flat: number[] = [], holeIdx: number[] = [];
  rings.forEach((r, k) => { if (k > 0) holeIdx.push(flat.length / 2); for (let q = 0; q < r.length - 1; q++) { const [x, y] = toData(r[q]); flat.push(x, y); } });
  const tri = earcut(flat, holeIdx, 2); if (tri.length === 0) return;
  const base = acc.positions.length / 2; const a = BAND_ALPHA(poly.band); const c = [Math.round(rgb[0] * a), Math.round(rgb[1] * a), Math.round(rgb[2] * a), Math.round(255 * a)];
  for (let i = 0; i < flat.length; i += 2) { acc.positions.push(flat[i], flat[i + 1]); acc.colors.push(c[0], c[1], c[2], c[3]); }
  for (const ix of tri) acc.indices.push(base + ix);
}
/** One line segment per ring edge; outer rings heavier and more opaque than inner ones. */
export function appendRingLines(acc: MeshAccumulator, ring: Ring, toData: ToData, rgb: RGB, outer: boolean): void {
  const st = outer ? LINE_OUTER : LINE_INNER; const a = Math.round(255 * st.alpha);
  for (let i = 0; i < ring.length - 1; i++) { const [ax, ay] = toData(ring[i]), [bx, by] = toData(ring[i + 1]); if (ax === bx && ay === by) continue; acc.lines.push(ax, ay, bx, by); acc.lineColors.push(rgb[0], rgb[1], rgb[2], a); acc.lineWidths.push(st.width); }
}
export function finalize(acc: MeshAccumulator, stats: Omit<TerrainStats, "triangles" | "segments">): TerrainMesh {
  const triCount = acc.indices.length / 3, segmentCount = acc.lines.length / 4;
  return { positions: Float32Array.from(acc.positions), colors: Uint8Array.from(acc.colors), indices: Uint32Array.from(acc.indices), triCount, lines: Float32Array.from(acc.lines), lineColors: Uint8Array.from(acc.lineColors), lineWidths: Float32Array.from(acc.lineWidths), segmentCount, stats: { ...stats, triangles: triCount, segments: segmentCount } };
}
export const emptyMesh = (stats: Omit<TerrainStats, "triangles" | "segments">): TerrainMesh => finalize(newAccumulator(), stats);
