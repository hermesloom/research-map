/** Kernel-density field on a grid, dominant category per cell, contour bands and marching-squares iso-lines.
 *  This reproduces the "density terrain" look: per-cluster coloured bands with concentric contour lines. */
export type GridSpec = { width: number; height: number; x0: number; x1: number; y0: number; y1: number };
export type DensityGrid = { D: Float32Array; bestCat: Int16Array; max: number; width: number; height: number };

export function computeDensityGrid(x: ArrayLike<number>, y: ArrayLike<number>, cat: ArrayLike<number>, spec: GridSpec, bandwidthPx: number): DensityGrid {
  const { width: w, height: h } = spec; const D = new Float32Array(w * h), bestW = new Float32Array(w * h), bestCat = new Int16Array(w * h).fill(-1);
  const sx = w / (spec.x1 - spec.x0), sy = h / (spec.y1 - spec.y0); const R = Math.ceil(bandwidthPx * 3), inv = 1 / (2 * bandwidthPx * bandwidthPx);
  for (let i = 0; i < x.length; i++) {
    const cx = (x[i] - spec.x0) * sx, cy = (spec.y1 - y[i]) * sy;                 // y up in data → down in grid
    const xa = Math.max(0, Math.floor(cx - R)), xb = Math.min(w - 1, Math.ceil(cx + R)), ya = Math.max(0, Math.floor(cy - R)), yb = Math.min(h - 1, Math.ceil(cy + R));
    for (let gy = ya; gy <= yb; gy++) for (let gx = xa; gx <= xb; gx++) {
      const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy; const wgt = Math.exp(-(dx * dx + dy * dy) * inv); if (wgt < 1e-4) continue;
      const k = gy * w + gx; D[k] += wgt; if (wgt > bestW[k]) { bestW[k] = wgt; bestCat[k] = cat[i]; }
    }
  }
  let max = 0; for (let k = 0; k < D.length; k++) if (D[k] > max) max = D[k];
  return { D, bestCat, max, width: w, height: h };
}
/** Six iso levels as fractions of the max density (outer → inner). */
export const bandLevels = (max: number) => [0.06, 0.14, 0.26, 0.42, 0.62, 0.85].map((f) => f * max);
export const bandOf = (v: number, levels: number[]) => { let b = 0; for (const l of levels) if (v > l) b++; return b; };

/** Marching squares with linear interpolation; returns line segments [x0, y0, x1, y1] in grid coordinates (cell corners at integers). */
export function marchingSquares(D: Float32Array, w: number, h: number, iso: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const lerp = (a: number, b: number, va: number, vb: number) => (vb === va ? (a + b) / 2 : a + ((iso - va) / (vb - va)) * (b - a));
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = D[y * w + x], tr = D[y * w + x + 1], br = D[(y + 1) * w + x + 1], bl = D[(y + 1) * w + x];
    const idx = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0); if (idx === 0 || idx === 15) continue;
    const top: [number, number] = [lerp(x, x + 1, tl, tr), y], right: [number, number] = [x + 1, lerp(y, y + 1, tr, br)], bottom: [number, number] = [lerp(x, x + 1, bl, br), y + 1], left: [number, number] = [x, lerp(y, y + 1, tl, bl)];
    const seg = (a: [number, number], b: [number, number]) => out.push([a[0], a[1], b[0], b[1]]);
    switch (idx) {
      case 1: case 14: seg(left, bottom); break; case 2: case 13: seg(bottom, right); break; case 3: case 12: seg(left, right); break;
      case 4: case 11: seg(top, right); break; case 6: case 9: seg(top, bottom); break; case 7: case 8: seg(left, top); break;
      case 5: seg(left, top); seg(bottom, right); break; case 10: seg(top, right); seg(left, bottom); break;
    }
  }
  return out;
}

/** Bucket segments by the grid tile containing their midpoint, so a zoomed-in frame strokes only the visible tiles. */
export function tileSegments(segs: [number, number, number, number][], w: number, h: number, tile: number): Map<string, [number, number, number, number][]> {
  const out = new Map<string, [number, number, number, number][]>();
  for (const s of segs) { const tx = Math.min(Math.floor(w / tile), Math.floor((s[0] + s[2]) / 2 / tile)), ty = Math.min(Math.floor(h / tile), Math.floor((s[1] + s[3]) / 2 / tile)); const k = `${tx},${ty}`; const a = out.get(k); if (a) a.push(s); else out.set(k, [s]); }
  return out;
}
