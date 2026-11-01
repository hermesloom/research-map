import { describe, it, expect } from "vitest";
import { buildNormalizeInput, normalizeItem } from "@/lib/llm/normalize";
const base = { xId: "1", createdAt: new Date("2026-10-01"), urls: [], media: [], isResearchQuestion: false, stage: "enriched", fetchedAt: new Date() } as any;

describe("normalize", () => {
  it("empty guard: no text, no transcript, no title → empty", () => {
    const r = buildNormalizeInput({ ...base, text: "https://t.co/x", kind: "media" }, { transcript: "", title: undefined });
    expect(r.empty).toBe(true);
  });
  it("includes page title/excerpt and transcript", () => {
    const r = buildNormalizeInput({ ...base, text: "https://t.co/x", kind: "link" }, { title: "XTDB", excerpt: "A bitemporal database." });
    expect(r.empty).toBe(false); expect(r.text).toContain("XTDB"); expect(r.text).toContain("bitemporal");
  });
  it("normalize self-reply without parent still works", async () => {
    const out = await normalizeItem({ ...base, text: "and this is why", kind: "selfReply", parentId: "0" }, {}, null, { parse: async () => ({ title: "t", summaryEn: "s", gist: "g", tagsEn: [], language: "en", entities: [], contentKind: "thought" }) } as any);
    expect(out!.title).toBe("t");
  });
  it("prepends parent text for self-replies when available", () => {
    const r = buildNormalizeInput({ ...base, text: "child", kind: "selfReply", parentId: "0" }, {}, { ...base, xId: "0", text: "PARENT TEXT", kind: "text" });
    expect(r.text.indexOf("PARENT TEXT")).toBeLessThan(r.text.indexOf("child"));
  });
  it("returns null for empty input without calling the model", async () => {
    let called = false;
    const out = await normalizeItem({ ...base, text: "", kind: "media" }, {}, null, { parse: async () => { called = true; return {} as any; } } as any);
    expect(out).toBeNull(); expect(called).toBe(false);
  });
});
