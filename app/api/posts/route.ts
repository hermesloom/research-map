import { getDb, collections } from "@/lib/db";
/** Delta of graded posts since an ISO timestamp (for the "what's new" badge). */
export async function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since"); const db = await getDb();
  const q: Record<string, unknown> = { stage: "graded", kind: { $nin: ["replyToOther", "retweet"] } }; if (since) q.fetchedAt = { $gt: new Date(since) };
  const rows = await collections(db).items.find(q, { projection: { _id: 0, xId: 1, createdAt: 1, fetchedAt: 1, kind: 1 } }).sort({ createdAt: -1 }).limit(200).toArray();
  return Response.json(rows, { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } });
}
