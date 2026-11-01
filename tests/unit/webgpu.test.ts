import { describe, it, expect } from "vitest";
import { hasWebGPU, probeWebGPU, FALLBACK_MESSAGE } from "@/app/canvas/webgpu";
describe("webgpu detection", () => {
  it("detects navigator.gpu presence", () => { expect(hasWebGPU({ gpu: {} } as any)).toBe(true); expect(hasWebGPU({} as any)).toBe(false); expect(FALLBACK_MESSAGE).toMatch(/WebGPU/); });
  it("probe requires an adapter with shader-f16 and wgslLanguageFeatures (what Embedding Atlas needs)", async () => {
    const nav = (adapter: any, wgsl = true) => ({ gpu: { requestAdapter: async () => adapter, wgslLanguageFeatures: wgsl ? new Set() : undefined } }) as any;
    expect(await probeWebGPU({} as any)).toBe(false);                                               // no navigator.gpu
    expect(await probeWebGPU(nav(null))).toBe(false);                                               // no adapter (headless shell)
    expect(await probeWebGPU(nav({ features: new Set([]) }))).toBe(false);                          // adapter without shader-f16 (swiftshader)
    expect(await probeWebGPU(nav({ features: new Set(["shader-f16"]) }, false))).toBe(false);       // no wgslLanguageFeatures
    expect(await probeWebGPU(nav({ features: new Set(["shader-f16"]) }))).toBe(true);
    expect(await probeWebGPU({ gpu: { requestAdapter: async () => { throw new Error("x"); } } } as any)).toBe(false);
  });
});
