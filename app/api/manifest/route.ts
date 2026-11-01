import { getDb, collections } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const db = await getDb(); const m = await collections(db).manifest.findOne({ _id: "current" });
  return Response.json(m ?? { error: "no snapshot yet" }, { status: m ? 200 : 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } });
}
