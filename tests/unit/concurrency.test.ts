import { describe, it, expect } from "vitest";
import { mapConcurrent } from "@/lib/pipeline/concurrency";
describe("mapConcurrent", () => {
  it("runs at most `limit` tasks at once, preserves order, and does not stop on one failure", async () => {
    let active = 0, peak = 0; const seen: number[] = [];
    const out = await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 10 * (8 - n))); active--; seen.push(n);
      if (n === 4) throw new Error("boom"); return n * 2;
    });
    expect(peak).toBe(3); expect(peak).toBeGreaterThan(1);
    expect(out.map((r) => (r.ok ? r.value : "err"))).toEqual([2, 4, 6, "err", 10, 12, 14]);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("handles an empty list", async () => { expect(await mapConcurrent([], 4, async (x: number) => x)).toEqual([]); });
});
