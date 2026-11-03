import type { Db } from "mongodb";
import { collections } from "../db";
import { env } from "../env";
import { runDaily, shouldDispatchRelayout } from "./run";
import { reconcileDeletions } from "./reconcile";
import type { RunDoc } from "../types";

/** The whole daily job as the cron runs it: the pipeline, the Sunday deletion sweep and, when the layout has drifted, a re-layout dispatch to GitHub. Shared by the scheduled cron and the manual trigger. */
export async function dailyJob(db: Db, opts: { force?: boolean } = {}): Promise<RunDoc> {
  const run = await runDaily(db, { force: opts.force });
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
  return run;
}

/** True when the request carries `Authorization: Bearer ${CRON_SECRET}`. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET; return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}
