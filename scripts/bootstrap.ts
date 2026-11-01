import fs from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv, env } from "@/lib/env";
import { getDb, collections, ensureIndexes, ensureVectorIndex, closeDb } from "@/lib/db";
import { parseTimeline } from "@/lib/x/parse";
import { defaultDeps, stageEnrich, stageNormalize, stageEmbed, stagePlace, stageGrade } from "@/lib/pipeline/stages";
import { toPayload, estimateFirecrawlCredits } from "./bootstrap-lib";

async function main() {

  const { values } = parseArgs({ options: { file: { type: "string" }, stage: { type: "string", default: "all" }, limit: { type: "string", default: "100000" }, yes: { type: "boolean", default: false } } });
  loadEnv();
  const db = await getDb(); await ensureIndexes(db); await ensureVectorIndex(db, env().EMBEDDING_DIMS);
  const c = collections(db); const d = defaultDeps(db); const limit = Number(values.limit);
  const run = { startedAt: new Date(), kind: "bootstrap" as const, counts: {} as Record<string, number>, errors: [] as string[], notes: [] as string[], ok: true };

  if (values.file) {
    const items = parseTimeline(toPayload(JSON.parse(fs.readFileSync(values.file, "utf8"))), env().X_USER_ID, env().RESEARCH_QUESTION_POST_ID); let ins = 0;
    for (const it of items) { const r = await c.items.updateOne({ xId: it.xId }, { $setOnInsert: it }, { upsert: true }); ins += r.upsertedCount; }
    run.counts.inserted = ins; const est = estimateFirecrawlCredits(items);
    console.log(`inserted ${ins}/${items.length}; firecrawl credit estimate ≈ ${est}`);
    if (est > 900 && !values.yes) { console.log("Estimate exceeds 900 credits; re-run with --yes or split with --limit."); await closeDb(); process.exit(2); }
  }
  const loop = async (name: string, fn: () => Promise<{ done: number }>) => { let total = 0; for (;;) { const r = await fn(); total += r.done; console.log(name, r); if (!r.done) break; } run.counts[name] = total; };
  const s = values.stage;
  if (s === "all" || s === "enrich") await loop("enrich", () => stageEnrich(d, Math.min(limit, 50)));
  if (s === "all" || s === "normalize") await loop("normalize", () => stageNormalize(d, Math.min(limit, 100)));
  if (s === "all" || s === "embed") await loop("embed", () => stageEmbed(d, Math.min(limit, 500)));
  if (s === "grade") { await loop("place", () => stagePlace(d, 500).then((r) => ({ done: r.done }))); await loop("grade", () => stageGrade(d, 100)); }
  await c.runs.insertOne({ ...run, finishedAt: new Date() }); console.log(run.counts); await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
