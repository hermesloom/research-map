import simplify from "simplify-js";
import type { Ring } from "./isobands";

/** Douglas–Peucker (simplify-js, high quality) on a closed ring; rings with fewer than 4 distinct vertices are returned as-is. */
export function simplifyRing(r: Ring, tol: number): Ring {
  if (r.length < 5) return r;
  const open = r.slice(0, -1).map(([x, y]) => ({ x, y })); const s = simplify(open, tol, true); if (s.length < 3) return r;
  const out: Ring = s.map((p) => [p.x, p.y] as [number, number]); out.push([out[0][0], out[0][1]]); return out;
}
/** Chaikin corner cutting on a closed ring: each edge (p, q) → (¾p + ¼q, ¼p + ¾q). */
export function chaikin(r: Ring, iterations: number): Ring {
  let cur = r;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length - 1; const out: Ring = [];
    for (let i = 0; i < n; i++) { const [px, py] = cur[i], [qx, qy] = cur[i + 1]; out.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy], [0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]); }
    out.push([out[0][0], out[0][1]]); cur = out;
  }
  return cur;
}
/** Closed ring with a single boundary type: simplify 0.2 → Chaikin ×2 → simplify 0.1. */
export function smoothRing(r: Ring): Ring { return simplifyRing(chaikin(simplifyRing(r, 0.2), 2), 0.1); }

// ---- open arcs (ring pieces between junctions), used so that a boundary shared by two regions is smoothed identically on both sides
export type Arc = { pts: Ring; density: boolean; closed: boolean };
/** Chaikin on an open polyline: endpoints fixed, each interior edge → two points. */
export function chaikinOpen(a: Ring, iterations: number): Ring {
  let cur = a;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur; const out: Ring = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) { const [px, py] = cur[i], [qx, qy] = cur[i + 1]; if (i > 0) out.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy]); if (i < cur.length - 2) out.push([0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]); }
    out.push(cur[cur.length - 1]); cur = out;
  }
  return cur;
}
function simplifyOpen(a: Ring, tol: number): Ring { if (a.length < 3) return a; const s = simplify(a.map(([x, y]) => ({ x, y })), tol, true); return s.map((p) => [p.x, p.y] as [number, number]); }
/** simplify 0.2 → Chaikin ×2 → simplify 0.1 on an open arc; endpoints are preserved exactly. */
export function smoothOpen(a: Ring): Ring { return simplifyOpen(chaikinOpen(simplifyOpen(a, 0.2), 2), 0.1); }
/** Canonical orientation for a seam arc (lexicographically smaller endpoint first), so both regions sharing it smooth the same sequence. */
export function canonicalArc(a: Ring): Ring { const p = a[0], q = a[a.length - 1]; const flip = q[0] < p[0] || (q[0] === p[0] && q[1] < p[1]); return flip ? [...a].reverse() : a; }
/** Split a closed ring into maximal runs of density edges / seam edges (consecutive arcs share their junction vertex). A ring with one edge type is returned as a single closed arc. */
export function splitRing(ring: Ring, isDensityEdge: (p: [number, number], q: [number, number]) => boolean): Arc[] {
  const n = ring.length - 1; if (n < 2) return [{ pts: ring, density: true, closed: true }];
  const types = new Array<boolean>(n); for (let i = 0; i < n; i++) types[i] = isDensityEdge(ring[i], ring[i + 1]);
  let start = -1; for (let i = 0; i < n; i++) if (types[i] !== types[(i - 1 + n) % n]) { start = i; break; }
  if (start < 0) return [{ pts: ring, density: types[0], closed: true }];
  const arcs: Arc[] = []; let i = start, guard = 0;
  do {
    const t = types[i]; const pts: Ring = [ring[i]]; let j = i;
    while (types[j] === t && guard++ < n * 2) { pts.push(ring[(j + 1) % n]); j = (j + 1) % n; if (j === start) break; }
    arcs.push({ pts, density: t, closed: false }); i = j;
  } while (i !== start && guard < n * 2);
  return arcs;
}
