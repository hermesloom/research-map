import { connection } from "next/server";
import { getDb, collections } from "@/lib/db";
export async function GET() {
  await connection();
  const db = await getDb(); const c = collections(db);
  const [runs, manifest, stages] = await Promise.all([
    c.runs.find({}).sort({ startedAt: -1 }).limit(5).toArray(), c.manifest.findOne({ _id: "current" }), c.items.aggregate([{ $group: { _id: "$stage", n: { $sum: 1 } } }]).toArray(),
  ]);
  return Response.json({ runs, manifest, stages }, { headers: { "Cache-Control": "no-store" } });
}
