export function hasWebGPU(nav: Partial<Navigator> = typeof navigator === "undefined" ? {} : navigator) { return "gpu" in nav && !!(nav as { gpu?: unknown }).gpu; }
export const FALLBACK_MESSAGE = "This map renders with WebGPU, which your browser does not expose. Try a current Chrome, Edge, Safari or Firefox.";

type GpuLike = { requestAdapter?: () => Promise<{ features?: Set<string> | { has(f: string): boolean } } | null>; wgslLanguageFeatures?: unknown };
/** Embedding Atlas needs a real adapter with `shader-f16` and `wgslLanguageFeatures`; presence of navigator.gpu is not enough (headless / software GPUs). */
export async function probeWebGPU(nav: Partial<Navigator> = typeof navigator === "undefined" ? {} : navigator): Promise<boolean> {
  const gpu = (nav as { gpu?: GpuLike }).gpu; if (!gpu?.requestAdapter || !gpu.wgslLanguageFeatures) return false;
  try { const a = await gpu.requestAdapter(); return !!a && !!a.features && a.features.has("shader-f16"); } catch { return false; }
}
