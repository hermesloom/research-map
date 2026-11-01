import { contours } from "d3-contour";
import type { Field } from "./kde";

export type Ring = [number, number][];                                   // closed ring (first == last) in sub-grid cell coordinates
export type BandPolygon = { outer: Ring; holes: Ring[]; band: number };  // band 1 = outermost level … 6 = innermost

/** Shoelace area; positive for counter-clockwise rings in a y-up frame. */
export function ringArea(r: Ring): number { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
/** Even-odd crossing test; points exactly on an edge count as outside. */
export function pointInRing(p: [number, number], r: Ring): boolean {
  let inside = false; const [x, y] = p;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; }
  return inside;
}
/** Marching-squares isolines per absolute level: polygons as [outer, ...holes] (d3 assigns holes by containment). */
export function isolines(field: Field, levelsAbs: number[]): Ring[][][] {
  const gen = contours().size([field.n, field.m]).smooth(true);
  return levelsAbs.map((lv) => (gen.contour(field.values as unknown as number[], lv).coordinates as unknown as Ring[][]).map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as [number, number]))));
}
/** Nested isobands: band i = level-i polygons, with the exterior rings of level i+1 that lie inside added as holes. Rings are shared by reference between neighbouring bands. */
export function isobands(perLevel: Ring[][][], minAreaCells = 4): BandPolygon[] {
  const out: BandPolygon[] = [];
  perLevel.forEach((polys, li) => {
    const upperOuters = (perLevel[li + 1] ?? []).map((p) => p[0]);
    for (const poly of polys) {
      const [outer, ...holes] = poly; if (Math.abs(ringArea(outer)) < minAreaCells) continue;
      const inner = upperOuters.filter((u) => u.length > 1 && pointInRing(u[0], outer) || (u.length > 1 && pointInRing(midpoint(u), outer)));
      out.push({ outer, holes: [...holes, ...inner], band: li + 1 });
    }
  });
  return out;
}
const midpoint = (r: Ring): [number, number] => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2];
