import type { Db } from "mongodb";
import { collections } from "../db";
import { parseTimeline } from "../x/parse";
import { fetchNewPosts } from "../x/client";
import { publishSnapshot } from "../publish";
import { env } from "../env";
import { defaultDeps, stageEnrich, stageNormalize, stageEmbed, stagePlace, stageGrade, ENRICH_MAX_DEFERRALS, type StageDeps } from "./stages";
import type { RunDoc } from "../types";

/** Newest stored post id, compared numerically (string compare is unsafe across id lengths). */
export async function watermark(db: Db): Promise<string | undefined> {
  const ids = await collections(db).items.find({}, { projection: { xId: 1 } }).toArray(); if (!ids.length) return undefined;
  return ids.map((d) => BigInt(d.xId)).reduce((a, b) => (a > b ? a : b)).toString();
}

export async function ingestNew(db: Db, deps: { fetchNewPosts: typeof fetchNewPosts; now: () => Date }, opts: { sinceId?: string; startTime?: string } = {}) {
  const c = collections(db); const sinceId = opts.sinceId ?? (await watermark(db));
  // No early return on an empty database: fetchNewPosts' billing guard throws without since_id/start_time, so an empty production DB fails loudly instead of sweeping. Bootstrap populates first.
  const { payload, requests } = await deps.fetchNewPosts({ sinceId, startTime: opts.startTime });
  const items = parseTimeline(payload, env().X_USER_ID, env().RESEARCH_QUESTION_POST_ID); let inserted = 0;
  for (const it of items) { const r = await c.items.updateOne({ xId: it.xId }, { $setOnInsert: it }, { upsert: true }); if (r.upsertedCount) inserted++; }
  return { inserted, requests, newestId: payload.meta?.newest_id };
}

type RunDeps = Partial<StageDeps> & { fetchNewPosts?: typeof fetchNewPosts; publish?: typeof publishSnapshot; budgetMs?: number; force?: boolean };

/** The daily job: idempotent, resumable, never throws; writes a `runs` document. */
export async function runDaily(db: Db, deps: RunDeps = {}): Promise<RunDoc> {
  const c = collections(db); const started = (deps.now ?? (() => new Date()))(); const budget = deps.budgetMs ?? 240_000;
  const d: StageDeps = { ...defaultDeps(db), ...deps, deadline: deps.deadline ?? (() => started.getTime() + budget - 30_000) };
  const run: RunDoc = { startedAt: started, kind: "daily", counts: {}, errors: [], notes: [], ok: true };
  const { insertedId } = await c.runs.insertOne(run); const timeLeft = () => budget - (Date.now() - started.getTime());
  try {
    const ing = await ingestNew(db, { fetchNewPosts: deps.fetchNewPosts ?? fetchNewPosts, now: d.now }); run.counts.ingested = ing.inserted; run.counts.xRequests = ing.requests;
    let changed = ing.inserted > 0;
    const steps: Array<[string, () => Promise<{ done: number; deferred?: number; deferredQuota?: number; deferredTransient?: number; errors?: number; skippedNoLayout?: boolean }>]> = [
      ["enrich", () => stageEnrich(d, 200)], ["normalize", () => stageNormalize(d, 300)], ["embed", () => stageEmbed(d, 500)], ["place", () => stagePlace(d, 500)], ["grade", () => stageGrade(d, 300)],
    ];
    for (const [name, fn] of steps) {
      if (timeLeft() < 20_000) { run.notes.push(`budget exhausted before ${name}`); break; }
      const r = await fn(); run.counts[name] = r.done ?? 0; if (r.done) changed = true;
      if (r.deferredQuota) run.notes.push(`firecrawl credits exhausted: ${r.deferredQuota} post${r.deferredQuota === 1 ? "" : "s"} wait for the next run`);
      if (r.deferredTransient) run.notes.push(`firecrawl failed or timed out for ${r.deferredTransient} post${r.deferredTransient === 1 ? "" : "s"}; retried next run, thin record after ${ENRICH_MAX_DEFERRALS} retries or 48 h (see stageError on the item)`);
      if (r.errors) run.errors.push(`${name}: ${r.errors} item errors`);
      if (r.skippedNoLayout) run.notes.push("no published layout yet; placement skipped");
    }
    const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } });
    if (layout?.points.length) {
      const prov = layout.points.filter((p) => p.provisional).length / layout.points.length; run.counts.provisionalPermille = Math.round(prov * 1000);
      if (prov > env().RELAYOUT_PROVISIONAL_THRESHOLD) run.notes.push("relayoutRecommended");
    }
    if ((changed || deps.force) && layout) { const m = await (deps.publish ?? publishSnapshot)(db); run.counts.published = m.count; }
  } catch (e) { run.ok = false; run.errors.push(String(e).slice(0, 500)); }
  run.finishedAt = d.now(); await c.runs.replaceOne({ _id: insertedId }, run); return run;
}

/** Back off re-layout dispatches: never while a draft newer than the published layout is waiting, and at most every 3 days. */
export function shouldDispatchRelayout(a: { recommended: boolean; hasNewerDraft: boolean; lastDispatchAt: Date | null; now: Date }): boolean {
  if (!a.recommended || a.hasNewerDraft) return false;
  return !a.lastDispatchAt || a.now.getTime() - a.lastDispatchAt.getTime() > 3 * 86400_000;
}
