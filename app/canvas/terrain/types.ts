/** Terrain geometry contract shared by the worker (builder) and the GL engine (consumer). All coordinates in data units. */
export type RGB = [number, number, number];
export type TerrainInput = { x: Float32Array; y: Float32Array; cat: Uint16Array; catRGB: RGB[]; sigmaUnits?: number; /** mass fractions for the six levels (default MASS_LEVELS) */ levels?: number[] };
export type TerrainStats = { categories: number; triangles: number; segments: number; ms: number; sigmaUnits: number };
export type TerrainMesh = {
  positions: Float32Array;   // x, y per vertex
  colors: Uint8Array;        // premultiplied RGBA per vertex
  indices: Uint32Array;      // triangle list
  triCount: number;
  lines: Float32Array;       // ax, ay, bx, by per segment
  lineColors: Uint8Array;    // RGBA (straight alpha) per segment
  lineWidths: Float32Array;  // CSS px per segment
  segmentCount: number;
  stats: TerrainStats;
};
/** Classic fraction-of-peak levels (used by tests and as the visual reference; the builder derives equivalent levels from enclosed mass). */
export const LEVELS = [0.06, 0.14, 0.26, 0.42, 0.62, 0.85];
/** Cumulative fill alpha seen at band b (1 = outermost … 6 = innermost); matches the previous renderer exactly. */
export const BAND_ALPHA = (b: number) => 0.10 + 0.075 * b;
/** Alpha to draw level b's region with when regions are stacked (level ≥ b drawn over level ≥ b−1): over-blending the stack reproduces BAND_ALPHA(b). */
export const BAND_ALPHA_INCREMENT = (b: number) => { const prev = b <= 1 ? 0 : BAND_ALPHA(b - 1); return (BAND_ALPHA(b) - prev) / (1 - prev); };
export const SIGMA_CELLS = 12;
export const LINE_OUTER = { width: 1.6, alpha: 0.95 }, LINE_INNER = { width: 1, alpha: 0.6 };
