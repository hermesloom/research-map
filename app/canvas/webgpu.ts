export function hasWebGPU(nav: Partial<Navigator> = typeof navigator === "undefined" ? {} : navigator) { return "gpu" in nav && !!(nav as { gpu?: unknown }).gpu; }
export const FALLBACK_MESSAGE = "This map renders with WebGPU, which your browser does not expose. Try a current Chrome, Edge, Safari or Firefox.";
