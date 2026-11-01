import { describe, it, expect } from "vitest";
import { hasWebGPU, FALLBACK_MESSAGE } from "@/app/canvas/webgpu";
describe("webgpu detection", () => { it("detects navigator.gpu", () => { expect(hasWebGPU({ gpu: {} } as any)).toBe(true); expect(hasWebGPU({} as any)).toBe(false); expect(FALLBACK_MESSAGE).toMatch(/WebGPU/); }); });
