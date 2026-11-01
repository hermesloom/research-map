/** Kernel-density field on a grid, dominant category per cell, contour bands and marching-squares iso-lines.
 *  This reproduces the "density terrain" look: per-cluster coloured bands with concentric contour lines. */
export type GridSpec = { width: number; height: number; x0: number; x1: number; y0: number; y1: number };
export const SLOTS = 4;
/** D: total density; bestCat: dominant category per cell; topCat/topW: the K strongest categories per cell with their accumulated weight (for smooth per-pixel category fields). */
export type DensityGrid = { D: Float32Array; bestCat: Int16Array; max: number; width: number; height: number; topCat: Int16Array; topW: Float32Array };

export function computeDensityGrid(x: ArrayLike<number>, y: ArrayLike<number>, cat: ArrayLike<number>, spec: GridSpec, bandwidthPx: number): DensityGrid {
  const { width: w, height: h } = spec; const n = w * h; const D = new Float32Array(n), bestCat = new Int16Array(n).fill(-1);
  const topCat = new Int16Array(n * SLOTS).fill(-1), topW = new Float32Array(n * SLOTS);
  const sx = w / (spec.x1 - spec.x0), sy = h / (spec.y1 - spec.y0); const R = Math.ceil(bandwidthPx * 3), inv = 1 / (2 * bandwidthPx * bandwidthPx);
  for (let i = 0; i < x.length; i++) {
    const cx = (x[i] - spec.x0) * sx, cy = (spec.y1 - y[i]) * sy; const c = cat[i];               // y up in data → down in grid
    const xa = Math.max(0, Math.floor(cx - R)), xb = Math.min(w - 1, Math.ceil(cx + R)), ya = Math.max(0, Math.floor(cy - R)), yb = Math.min(h - 1, Math.ceil(cy + R));
    for (let gy = ya; gy <= yb; gy++) for (let gx = xa; gx <= xb; gx++) {
      const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy; const wgt = Math.exp(-(dx * dx + dy * dy) * inv); if (wgt < 1e-4) continue;
      const k = gy * w + gx; D[k] += wgt; const base = k * SLOTS; let slot = -1, minSlot = 0;
      for (let s2 = 0; s2 < SLOTS; s2++) { if (topCat[base + s2] === c) { slot = s2; break; } if (topCat[base + s2] === -1) { slot = s2; topCat[base + s2] = c; break; } if (topW[base + s2] < topW[base + minSlot]) minSlot = s2; }
      if (slot === -1) { if (wgt > topW[base + minSlot]) { topCat[base + minSlot] = c; topW[base + minSlot] = 0; slot = minSlot; } else continue; }
      topW[base + slot] += wgt;
    }
  }
  let max = 0;
  for (let k = 0; k < n; k++) { if (D[k] > max) max = D[k]; let bw = -1; for (let s2 = 0; s2 < SLOTS; s2++) if (topCat[k * SLOTS + s2] !== -1 && topW[k * SLOTS + s2] > bw) { bw = topW[k * SLOTS + s2]; bestCat[k] = topCat[k * SLOTS + s2]; } }
  return { D, bestCat, max, width: w, height: h, topCat, topW };
}
/** Category at a sub-cell position: bilinear interpolation of each candidate category's own field over the 4 surrounding cells, argmax. */
export function categoryAt(g: DensityGrid, gx: number, gy: number): number {
  const { width: gw, height: gh, topCat, topW } = g; const fxr = gx - 0.5, fyr = gy - 0.5; const x0 = Math.floor(fxr), y0 = Math.floor(fyr); const fx = fxr - x0, fy = fyr - y0;
  const xa = Math.min(gw - 1, Math.max(0, x0)), xb = Math.min(gw - 1, Math.max(0, x0 + 1)), ya = Math.min(gh - 1, Math.max(0, y0)), yb = Math.min(gh - 1, Math.max(0, y0 + 1));
  const cells = [ya * gw + xa, ya * gw + xb, yb * gw + xa, yb * gw + xb], wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let best = -1, bestV = 0;
  for (let ci = 0; ci < 4; ci++) for (let s2 = 0; s2 < SLOTS; s2++) {
    const c = topCat[cells[ci] * SLOTS + s2]; if (c === -1) continue; let v = 0;
    for (let cj = 0; cj < 4; cj++) { const b = cells[cj] * SLOTS; for (let t = 0; t < SLOTS; t++) if (topCat[b + t] === c) { v += wts[cj] * topW[b + t]; break; } }
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
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

/** Render band fills at screen resolution for a region of the grid: bilinear density, nearest-cell category.
 *  (gx0, gy0) = grid coordinate of the image's top-left pixel; cellsPerPx = grid cells per image pixel. */
export function renderBandImage(grid: DensityGrid, levels: number[], catRGB: [number, number, number][], view: { gx0: number; gy0: number; cellsPerPx: number }, w: number, h: number, catAt?: (gx: number, gy: number) => number): Uint8ClampedArray<ArrayBuffer> {
  const { D, bestCat, width: gw, height: gh } = grid; const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4)); const L = levels.length; const l0 = levels[0];
  for (let py = 0; py < h; py++) {
    const gy = view.gy0 + (py + 0.5) * view.cellsPerPx - 0.5; const y0 = Math.floor(gy); const fy = gy - y0; const ya = Math.min(gh - 1, Math.max(0, y0)), yb = Math.min(gh - 1, Math.max(0, y0 + 1));
    for (let px = 0; px < w; px++) {
      const gx = view.gx0 + (px + 0.5) * view.cellsPerPx - 0.5; const x0 = Math.floor(gx); const fx = gx - x0; const xa = Math.min(gw - 1, Math.max(0, x0)), xb = Math.min(gw - 1, Math.max(0, x0 + 1));
      const d = D[ya * gw + xa] * (1 - fx) * (1 - fy) + D[ya * gw + xb] * fx * (1 - fy) + D[yb * gw + xa] * (1 - fx) * fy + D[yb * gw + xb] * fx * fy;
      if (d <= l0) continue;
      let b = 1; for (let i = 1; i < L; i++) if (d > levels[i]) b++;
      // category: nearest data point when an index is given (smooth Voronoi boundaries), else the cell's dominant category
      let cat = catAt ? catAt(gx + 0.5, gy + 0.5) : categoryAt(grid, gx + 0.5, gy + 0.5); if (cat < 0) cat = bestCat[(fy < 0.5 ? ya : yb) * gw + (fx < 0.5 ? xa : xb)];
      const c = catRGB[cat] ?? [200, 200, 200]; const o = (py * w + px) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Math.round(255 * (0.10 + 0.075 * b));
    }
  }
  return out;
}

