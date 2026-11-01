import { connection } from "next/server";
import { getDb, collections } from "@/lib/db";
export async function GET() {
  await connection();
  const db = await getDb(); const m = await collections(db).manifest.findOne({ _id: "current" });
  return Response.json(m ?? { error: "no snapshot yet" }, { status: m ? 200 : 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } });
}
