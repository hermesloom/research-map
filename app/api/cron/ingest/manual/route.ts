import { after, connection } from "next/server";
import { getDb, collections } from "@/lib/db";
import { dailyJob, cronAuthorized } from "@/lib/pipeline/job";
export const maxDuration = 800;

/** A run older than this with no finishedAt is a crashed one, not one to attach to. */
const RUNNING_WINDOW_MS = 15 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };

/** Browser trigger for the daily job. Answers at once with the start time and runs the job after the response, so no connection has to stay open for minutes. If a run is still going, the client attaches to it instead of starting a second one. */
export async function POST(request: Request) {
  await connection();
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const db = await getDb(); const c = collections(db); const now = new Date();
  const running = await c.runs.findOne({ finishedAt: { $exists: false }, startedAt: { $gte: new Date(now.getTime() - RUNNING_WINDOW_MS) } }, { sort: { startedAt: -1 }, projection: { startedAt: 1 } });
  if (running) return Response.json({ startedAt: running.startedAt.toISOString(), attached: true }, { status: 202, headers: NO_STORE });
  after(() => dailyJob(db));
  return Response.json({ startedAt: now.toISOString(), attached: false }, { status: 202, headers: NO_STORE });
}

/** Poll: the newest run started at or after `since`, without `finishedAt` while it is still going, or `null` before it has been written. */
export async function GET(request: Request) {
  await connection();
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const since = new Date(new URL(request.url).searchParams.get("since") ?? ""); if (Number.isNaN(since.getTime())) return new Response("bad request", { status: 400 });
  const run = await collections(await getDb()).runs.findOne({ startedAt: { $gte: since } }, { sort: { startedAt: -1 }, projection: { _id: 0, startedAt: 1, finishedAt: 1, ok: 1, counts: 1, errors: 1, notes: 1 } });
  return Response.json({ run: run ?? null }, { headers: NO_STORE });
}
