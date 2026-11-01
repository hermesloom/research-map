import { connection } from "next/server";
import { z } from "zod";
import { isOwner } from "@/lib/ownerAuth";
import { getDb, collections } from "@/lib/db";
import { publishSnapshot } from "@/lib/publish";
import type { Override } from "@/lib/types";

/** Per-type payload schemas: a malformed override must never reach the layout (NaN coordinates, "undefined" labels). */
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pin"), xId: z.string().min(1), payload: z.object({ x: z.number().finite(), y: z.number().finite() }) }),
  z.object({ type: z.literal("renameLabel"), clusterId: z.number().int().nonnegative(), payload: z.object({ label: z.string().trim().min(1).max(80) }) }),
  z.object({ type: z.literal("moveLeaf"), xId: z.string().min(1), payload: z.object({ clusterId: z.number().int().min(-1) }) }),
  z.object({ type: z.literal("retireQuestion"), questionId: z.string().min(1), payload: z.object({}).default({}) }),
  z.object({ type: z.literal("trailEdit"), questionId: z.string().min(1), payload: z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }) }),
]);
export async function GET(request: Request) { await connection(); return Response.json({ owner: isOwner(request) }, { headers: { "Cache-Control": "no-store" } }); }
/** Owner curation: stored with curated authority, applied at publish time, survives re-layouts. Republishes immediately. */
export async function POST(request: Request) {
  await connection();
  if (!isOwner(request)) return new Response("unauthorized", { status: 401 });
  const r = Body.safeParse(await request.json().catch(() => null)); if (!r.success) return new Response("bad request", { status: 400 });
  const db = await getDb(); const c = collections(db);
  const doc: Override = { ...r.data, createdAt: new Date() } as Override; await c.overrides.insertOne(doc);
  if (r.data.type === "retireQuestion") await c.questions.updateOne({ _id: r.data.questionId }, { $set: { validTo: new Date() } });
  const m = await publishSnapshot(db); return Response.json(m);
}
/** Undo the most recent override and republish. */
export async function DELETE(request: Request) {
  await connection();
  if (!isOwner(request)) return new Response("unauthorized", { status: 401 });
  const db = await getDb(); const c = collections(db);
  const [last] = await c.overrides.find({}).sort({ createdAt: -1 }).limit(1).toArray(); if (!last) return Response.json({ undone: null });
  await c.overrides.deleteOne({ _id: (last as { _id?: unknown })._id as never });
  const m = await publishSnapshot(db); return Response.json({ undone: last.type, manifest: m });
}
