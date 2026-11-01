import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { runDaily, shouldDispatchRelayout } from "@/lib/pipeline/run";
import { collections } from "@/lib/db";
import { reconcileDeletions } from "@/lib/pipeline/reconcile";
import { env } from "@/lib/env";
export const maxDuration = 800;

/** Daily job. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. `?force=1` republishes even without changes (used by the batch job). */
export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET; const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  const db = await getDb(); const run = await runDaily(db, { force });
  if (new Date().getUTCDay() === 0) { try { await reconcileDeletions(db, {}); } catch (e) { run.notes.push(`reconcile failed: ${String(e).slice(0, 200)}`); } }
  const c = collections(db);
  const published = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 }, projection: { version: 1 } });
  const hasNewerDraft = !!(await c.layouts.findOne({ status: "draft", version: { $gt: published?.version ?? 0 } }, { projection: { version: 1 } }));
  const lastDispatch = await c.runs.findOne({ notes: "relayoutDispatched" }, { sort: { startedAt: -1 }, projection: { startedAt: 1 } });
  if (shouldDispatchRelayout({ recommended: run.notes.includes("relayoutRecommended"), hasNewerDraft, lastDispatchAt: lastDispatch?.startedAt ?? null, now: new Date() }) && process.env.GITHUB_DISPATCH_TOKEN) {
    run.notes.push("relayoutDispatched"); await c.runs.updateOne({ startedAt: run.startedAt }, { $set: { notes: run.notes } });
    await fetch(`https://api.github.com/repos/${env().GITHUB_REPO}/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "research-map" },
      body: JSON.stringify({ event_type: "relayout" }),
    }).catch(() => {});
  }
  return Response.json(run, { status: run.ok ? 200 : 500 });
}
