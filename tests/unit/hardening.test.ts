import { describe, it, expect } from "vitest";
import { fetchWithTimeout } from "@/lib/pipeline/concurrency";
import { mapConcurrent } from "@/lib/pipeline/concurrency";
import { planReconcile } from "@/lib/pipeline/reconcile";
import { shouldDispatchRelayout } from "@/lib/pipeline/run";

describe("fetchWithTimeout", () => {
  it("aborts a hung request after the timeout", async () => {
    const hung = ((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
    await expect(fetchWithTimeout(hung, 50)("https://x/")).rejects.toThrow(/abort/);
  });
});
describe("mapConcurrent deadline", () => {
  it("stops starting new items once the deadline has passed and reports them as skipped", async () => {
    const dl = Date.now() + 45; const out = await mapConcurrent([1, 2, 3, 4], 1, async (n) => { await new Promise((r) => setTimeout(r, 30)); return n; }, { deadline: () => dl });
    const skipped = out.filter((r) => !r.ok && (r as any).skipped).length; expect(skipped).toBeGreaterThanOrEqual(1); expect(out[0].ok).toBe(true);
  });
});
describe("planReconcile", () => {
  const now = new Date("2026-11-08T00:00:00Z"); const recent = new Date("2026-11-01T00:00:00Z");
  const local = Array.from({ length: 20 }, (_, i) => ({ xId: String(i), createdAt: recent }));
  it("refuses to tombstone anything when the remote window was truncated", () => {
    const r = planReconcile(local, ["1"], now, { truncated: true }); expect(r.toDelete).toEqual([]); expect(r.aborted).toMatch(/truncated/);
  });
  it("refuses to tombstone more than 10% of the window at once", () => {
    const r = planReconcile(local, ["1", "2"], now, { truncated: false }); expect(r.toDelete).toEqual([]); expect(r.aborted).toMatch(/10%/);
  });
  it("tombstones a plausible number", () => {
    const r = planReconcile(local, local.slice(1).map((l) => l.xId), now, { truncated: false }); expect(r.toDelete).toEqual(["0"]); expect(r.aborted).toBeNull();
  });
});
describe("shouldDispatchRelayout", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  it("dispatches when recommended, no newer draft, and no dispatch in the last 3 days", () => { expect(shouldDispatchRelayout({ recommended: true, hasNewerDraft: false, lastDispatchAt: null, now })).toBe(true); });
  it("backs off on a newer draft or a recent dispatch", () => {
    expect(shouldDispatchRelayout({ recommended: true, hasNewerDraft: true, lastDispatchAt: null, now })).toBe(false);
    expect(shouldDispatchRelayout({ recommended: true, hasNewerDraft: false, lastDispatchAt: new Date("2026-11-09T00:00:00Z"), now })).toBe(false);
    expect(shouldDispatchRelayout({ recommended: true, hasNewerDraft: false, lastDispatchAt: new Date("2026-11-01T00:00:00Z"), now })).toBe(true);
  });
});
