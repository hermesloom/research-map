import { describe, it, expect } from "vitest";
import { monthBins, gradeBins } from "@/app/canvas/histogram";
describe("histogram", () => {
  it("bins by UTC month with labels and ranges", () => {
    const t = (s: string) => Math.floor(Date.parse(s) / 1000);
    const b = monthBins([t("2026-09-01T00:00:00Z"), t("2026-09-30T23:59:59Z"), t("2026-10-05T00:00:00Z")]);
    expect(b.map((x) => [x.label, x.count])).toEqual([["2026-09", 2], ["2026-10", 1]]); expect(b[0].start).toBeLessThanOrEqual(t("2026-09-01T00:00:00Z")); expect(b[0].end).toBeGreaterThanOrEqual(t("2026-09-30T23:59:59Z"));
  });
  it("gradeBins counts 0..3", () => { expect(gradeBins([3, 3, 1, 0, 2])).toEqual([1, 1, 1, 2]); });
});
