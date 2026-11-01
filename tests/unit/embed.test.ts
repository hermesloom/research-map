import { describe, it, expect } from "vitest";
import { embedTexts, embeddingInput, cosine, jitterFromId } from "@/lib/llm/embed";
describe("embed", () => {
  it("batches by 100 and preserves order", async () => {
    process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k";
    const calls: number[] = [];
    const client = { embeddings: { create: async ({ input }: any) => { calls.push(input.length); return { data: input.map((_: any, i: number) => ({ index: i, embedding: [input.length, i] })) }; } } };
    const out = await embedTexts(Array.from({ length: 150 }, (_, i) => `t${i}`), { client } as any);
    expect(calls).toEqual([100, 50]); expect(out.length).toBe(150); expect(out[149]).toEqual([50, 49]);
  });
  it("cosine and deterministic jitter", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1); expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(jitterFromId("abc")).toEqual(jitterFromId("abc")); expect(jitterFromId("abc")).not.toEqual(jitterFromId("abd"));
    const [jx, jy] = jitterFromId("x"); expect(Math.abs(jx)).toBeLessThanOrEqual(1); expect(Math.abs(jy)).toBeLessThanOrEqual(1);
  });
  it("embeddingInput joins title and summary", () => { expect(embeddingInput({ title: "A", summaryEn: "B." } as any)).toBe("A. B."); });
});
