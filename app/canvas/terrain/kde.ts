import { blur2 } from "d3-array";

/** Median nearest-neighbour distance over a sample of points (brute force; n ≤ a few thousand). 1 when fewer than two points. */
export function medianNN(x: ArrayLike<number>, y: ArrayLike<number>, sample = 300): number {
  const n = x.length; if (n < 2) return 1; const stride = Math.max(1, Math.floor(n / sample)); const d: number[] = [];
  for (let i = 0; i < n; i += stride) { let best = Infinity; for (let j = 0; j < n; j++) { if (j === i) continue; const dd = (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2; if (dd < best) best = dd; } d.push(Math.sqrt(best)); }
  d.sort((a, b) => a - b); return d[Math.floor(d.length / 2)] || 1;
}
export function extentOf(x: ArrayLike<number>, y: ArrayLike<number>) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < x.length; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
  if (!Number.isFinite(x0)) { x0 = x1 = y0 = y1 = 0; } return { x0, x1, y0, y1, side: Math.max(x1 - x0, y1 - y0) || 1 };
}
/** Kernel bandwidth in data units: 2.5 × median NN spacing, clamped to 2–8 % of the larger bounding-box side. Works for any lens geometry. */
export function chooseSigma(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const { side } = extentOf(x, y); return Math.min(0.08 * side, Math.max(0.02 * side, 2.5 * medianNN(x, y)));
}

export type Field = { values: Float32Array; n: number; m: number; ox: number; oy: number; peak: number };
/** Gaussian KDE on a sub-grid covering the points' bbox padded by 3σ: bilinear splat + three-pass box blur (d3 blur2, σ = sigmaCells). Cell (i, j) covers data [(ox+i)/cpu, (ox+i+1)/cpu) etc.; y is NOT flipped. */
export function densityField(px: ArrayLike<number>, py: ArrayLike<number>, cellsPerUnit: number, sigmaCells: number): Field {
  const pad = Math.ceil(3 * sigmaCells); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < px.length; i++) { const X = px[i] * cellsPerUnit, Y = py[i] * cellsPerUnit; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
  const ox = Math.floor(x0) - pad, oy = Math.floor(y0) - pad; const n = Math.ceil(x1) - ox + pad + 2, m = Math.ceil(y1) - oy + pad + 2;
  const values = new Float32Array(n * m);
  for (let i = 0; i < px.length; i++) {
    const X = px[i] * cellsPerUnit - ox, Y = py[i] * cellsPerUnit - oy; const xi = Math.floor(X), yi = Math.floor(Y), xt = X - xi, yt = Y - yi;
    values[xi + yi * n] += (1 - xt) * (1 - yt); values[xi + 1 + yi * n] += xt * (1 - yt); values[xi + (yi + 1) * n] += (1 - xt) * yt; values[xi + 1 + (yi + 1) * n] += xt * yt;
  }
  const r = (Math.sqrt(4 * sigmaCells * sigmaCells + 1) - 1) / 2; blur2({ data: values, width: n, height: m }, r);
  let peak = 0; for (let k = 0; k < values.length; k++) if (values[k] > peak) peak = values[k];
  return { values, n, m, ox, oy, peak };
}
