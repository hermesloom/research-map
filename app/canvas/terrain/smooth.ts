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
/** Chaikin ×2 (corner cutting keeps a simple ring simple) → simplify 0.15 cell (light, so rings traced separately for neighbouring regions keep nearly identical shared boundaries). */
export function smoothRing(r: Ring): Ring { return simplifyRing(chaikin(r, 2), 0.15); }
