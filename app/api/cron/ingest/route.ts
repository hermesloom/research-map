import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { runDaily } from "@/lib/pipeline/run";
import { reconcileDeletions } from "@/lib/pipeline/reconcile";
import { env } from "@/lib/env";
export const maxDuration = 300;

/** Daily job. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. `?force=1` republishes even without changes (used by the batch job). */
export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET; const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  const db = await getDb(); const run = await runDaily(db, { force });
  if (new Date().getUTCDay() === 0) { try { await reconcileDeletions(db, {}); } catch (e) { run.notes.push(`reconcile failed: ${String(e).slice(0, 200)}`); } }
  if (run.notes.includes("relayoutRecommended") && process.env.GITHUB_DISPATCH_TOKEN) {
    await fetch(`https://api.github.com/repos/${env().GITHUB_REPO}/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "research-map" },
      body: JSON.stringify({ event_type: "relayout" }),
    }).catch(() => {});
  }
  return Response.json(run, { status: run.ok ? 200 : 500 });
}
