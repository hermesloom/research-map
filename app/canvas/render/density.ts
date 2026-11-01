/** Density terrain: coloured gaussian splats rendered once into an offscreen raster that covers the data extent. */
export function rasterSpec(x: ArrayLike<number>, y: ArrayLike<number>, maxSide = 1024, margin = 0.08) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < x.length; i++) { if (x[i] < xmin) xmin = x[i]; if (x[i] > xmax) xmax = x[i]; if (y[i] < ymin) ymin = y[i]; if (y[i] > ymax) ymax = y[i]; }
  if (!Number.isFinite(xmin)) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
  const dx = (xmax - xmin) || 1, dy = (ymax - ymin) || 1; const mx = dx * margin, my = dy * margin;
  const x0 = xmin - mx, x1 = xmax + mx, y0 = ymin - my, y1 = ymax + my; const aspect = (y1 - y0) / (x1 - x0);
  const width = aspect <= 1 ? maxSide : Math.round(maxSide / aspect), height = aspect <= 1 ? Math.round(maxSide * aspect) : maxSide;
  const pxPerUnit = width / (x1 - x0);
  return { width, height, x0, x1, y0, y1, pxPerUnit, toPixel: (X: number, Y: number) => ({ x: (X - x0) * pxPerUnit, y: (y1 - Y) * pxPerUnit }) };
}
export function medianSpacing(x: ArrayLike<number>, y: ArrayLike<number>, sample = 300): number {
  const n = x.length; if (n < 2) return 1; const stride = Math.max(1, Math.floor(n / sample)); const d: number[] = [];
  for (let i = 0; i < n; i += stride) { let best = Infinity; for (let j = 0; j < n; j++) { if (j === i) continue; const dd = (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2; if (dd < best) best = dd; } d.push(Math.sqrt(best)); }
  d.sort((a, b) => a - b); return d[Math.floor(d.length / 2)] || 1;
}
