/** Shape of the debug hook MapView installs on window.__map. */
export type MapHook = {
  stats(): { mode: string; drawCalls: number; terrain: { categories: number } | null; frameMs: number[]; points: number; labels: number; spacingPx: number };
  readPixel(x: number, y: number): number[]; project(x: number, y: number): { x: number; y: number };
  labels(): { text: string; level: number; opacity: number; row?: number }[]; camera(): { x: number; y: number; scale: number }; setCamera(c: { x: number; y: number; scale: number }): void; pointAt(row: number): { x: number; y: number } | null; highlights(): { row: number; alpha: number }[];
};
declare global { interface Window { __map: MapHook } }
export const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
