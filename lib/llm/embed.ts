import { env } from "../env";
import { getOpenAI } from "./openai";
import { sha256 } from "../hash";
import type { Normalized } from "../types";

export const embeddingInput = (n: Normalized) => `${n.title.replace(/\.$/, "")}. ${n.summaryEn}`;

export async function embedTexts(texts: string[], deps?: { client: ReturnType<typeof getOpenAI> }): Promise<number[][]> {
  const client = deps?.client ?? getOpenAI(); const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const r = await client.embeddings.create({ model: env().EMBEDDING_MODEL, dimensions: env().EMBEDDING_DIMS, input: batch });
    const sorted = [...r.data].sort((a, b) => a.index - b.index); out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}
export function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
/** Deterministic jitter in [-1, 1]² derived from the post id, so re-placement is reproducible. */
export function jitterFromId(xId: string): [number, number] {
  const h = sha256(xId); const u = (s: string) => parseInt(s, 16) / 0xffffffff;
  return [u(h.slice(0, 8)) * 2 - 1, u(h.slice(8, 16)) * 2 - 1];
}
