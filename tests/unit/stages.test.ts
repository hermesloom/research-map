import { describe, it, expect } from "vitest";
import { nextStage } from "@/lib/pipeline/stages";
describe("stage order", () => {
  it("advances in the spec order and terminates", () => {
    const order: string[] = []; let s: any = "ingested"; while (s) { order.push(s); s = nextStage(s); }
    expect(order).toEqual(["ingested", "enriched", "normalized", "embedded", "placed", "graded"]);
  });
});
