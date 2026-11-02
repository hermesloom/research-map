import type { Corpus, Post } from "./corpus";
import { ApiError } from "./http";
import { devManifestPath } from "./loader";

export interface SearchDeps { embed: (texts: string[]) => Promise<number[][]>; knn: (vector: number[], limit: number) => Promise<{ xId: string; score: number }[]>; configured: () => boolean }
export const defaultSearchDeps = (): SearchDeps => ({
  configured: () => !!process.env.OPENAI_API_KEY && !!process.env.MONGODB_URI && !devManifestPath(),
  embed: async (texts) => (await import("../llm/embed")).embedTexts(texts),
  knn: async (vector, limit) => {
    const { getDb } = await import("../db"); const db = await getDb();
    return db.collection("vectors").aggregate<{ xId: string; score: number }>([
      { $vectorSearch: { index: "embedding_idx", path: "embedding", queryVector: vector, exact: true, limit } },
      { $project: { _id: 0, xId: 1, score: { $meta: "vectorSearchScore" } } },
    ]).toArray();
  },
});
export const searchUnavailable = () => new ApiError(503, "search_unavailable", "Semantic search is not available on this deployment.", "It needs an embedding key and the Atlas vector index. Use /api/v1/posts?q=<words> for a lexical filter instead.");
export const searchFailed = (e: unknown) => new ApiError(503, "search_failed", "The search backend did not answer.", `Retry in a moment, or use /api/v1/posts?q=<words> for a lexical filter. (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"})`);

/** Embed the query, exact kNN over the stored vectors, then join to the snapshot's posts. Never a silent lexical fallback. */
export async function semanticSearch(c: Corpus, q: string, limit: number, minGrade: number | undefined, deps: SearchDeps = defaultSearchDeps()): Promise<(Post & { score: number })[]> {
  if (!deps.configured()) throw searchUnavailable();
  let v: number[], rows: { xId: string; score: number }[];
  try { [v] = await deps.embed([q]); rows = await deps.knn(v, Math.min(200, limit * (minGrade !== undefined ? 10 : 3) + 1)); }   // a grade filter discards most candidates; ask for more
  catch (e) { throw searchFailed(e); }
  const out: (Post & { score: number })[] = [];
  for (const r of rows) {
    const p = c.byId.get(r.xId); if (!p || p.isResearchQuestion) continue;
    if (minGrade !== undefined && (p.relevance.grade === null || p.relevance.grade < minGrade)) continue;
    out.push({ ...p, score: Math.round(r.score * 10_000) / 10_000 }); if (out.length >= limit) break;
  }
  return out;
}
