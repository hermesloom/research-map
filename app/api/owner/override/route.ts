import { connection } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/ownerAuth";
import { getDb, collections } from "@/lib/db";
import { publishSnapshot } from "@/lib/publish";
import type { Override } from "@/lib/types";

const Body = z.object({
  type: z.enum(["pin", "renameLabel", "moveLeaf", "retireQuestion", "trailEdit"]),
  xId: z.string().optional(), clusterId: z.number().int().optional(), questionId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export async function GET(request: Request) { await connection(); return Response.json({ owner: isOwner(request) }, { headers: { "Cache-Control": "no-store" } }); }
/** Owner curation: stored with curated authority, applied at publish time, survives re-layouts. Republishes immediately. */
export async function POST(request: Request) {
  await connection();
  if (!isOwner(request)) return new Response("unauthorized", { status: 401 });
  const r = Body.safeParse(await request.json().catch(() => null)); if (!r.success) return new Response("bad request", { status: 400 });
  const db = await getDb(); const c = collections(db);
  const doc: Override = { ...r.data, createdAt: new Date() }; await c.overrides.insertOne(doc);
  if (r.data.type === "retireQuestion" && r.data.questionId) await c.questions.updateOne({ _id: r.data.questionId }, { $set: { validTo: new Date() } });
  const m = await publishSnapshot(db); return Response.json(m);
}
