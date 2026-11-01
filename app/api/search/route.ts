import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { embedTexts } from "@/lib/llm/embed";
import { env } from "@/lib/env";
/** Semantic search: embed the query, exact kNN in Atlas, exclude the research-question post itself. */
export async function GET(request: Request) {
  await connection();
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 300); if (!q) return Response.json([]);
  const [v] = await embedTexts([q]); const db = await getDb();
  const rows = await db.collection("vectors").aggregate<{ xId: string; score: number }>([
    { $vectorSearch: { index: "embedding_idx", path: "embedding", queryVector: v, exact: true, limit: 21 } },
    { $project: { _id: 0, xId: 1, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  return Response.json(rows.filter((r) => r.xId !== env().RESEARCH_QUESTION_POST_ID).slice(0, 20), { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" } });
}
