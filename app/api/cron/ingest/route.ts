import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { dailyJob, cronAuthorized } from "@/lib/pipeline/job";
export const maxDuration = 800;

/** Daily job. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. `?force=1` republishes even without changes (used by the batch job). Browsers use `./manual` instead: this response stays silent for minutes and gets dropped on the way. */
export async function GET(request: Request) {
  await connection();
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  const run = await dailyJob(await getDb(), { force });
  return Response.json(run, { status: run.ok ? 200 : 500 });
}
