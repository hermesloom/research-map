import type { Db } from "mongodb";
import { collections } from "../db";
import type { Stage } from "../types";
import { enrichUrl } from "../enrich/ladder";
import { describeImage } from "../enrich/vision";
import { USER_AGENT } from "../enrich/types";
import { normalizeItem } from "../llm/normalize";
import { embedTexts, embeddingInput } from "../llm/embed";
import { gradeItem } from "../llm/grade";
import { placeItem } from "../place";
import { sha256 } from "../hash";
import { env } from "../env";

export interface StageDeps {
  db: Db; fetchImpl: typeof fetch; enrichUrl: typeof enrichUrl; describeImage: typeof describeImage; normalizeItem: typeof normalizeItem;
  embedTexts: typeof embedTexts; gradeItem: typeof gradeItem; placeItem: typeof placeItem; now: () => Date; log: (s: string) => void;
}
export const defaultDeps = (db: Db): StageDeps => ({ db, fetchImpl: fetch, enrichUrl, describeImage, normalizeItem, embedTexts, gradeItem, placeItem, now: () => new Date(), log: console.log });
const ORDER: Stage[] = ["ingested", "enriched", "normalized", "embedded", "placed", "graded"];
export const nextStage = (s: Stage): Stage | null => ORDER[ORDER.indexOf(s) + 1] ?? null;
const EXCLUDED = ["replyToOther", "retweet"] as const;

/** ingested → enriched. Replies to others and retweets skip straight to graded (kept, never on the canvas). */
export async function stageEnrich(d: StageDeps, limit: number) {
  const c = collections(d.db); const out = { done: 0, deferred: 0, errors: 0 };
  await c.items.updateMany({ stage: "ingested", kind: { $in: [...EXCLUDED] } }, { $set: { stage: "graded" } });
  const todo = await c.items.find({ stage: "ingested" }).sort({ createdAt: 1 }).limit(limit).toArray();
  for (const it of todo) {
    try {
      let doc: Record<string, unknown> = { xId: it.xId, source: "none", thin: true, needsContent: false, fetchedAt: d.now() };
      const url = it.urls.find((u) => !u.isMedia && !/^(x|twitter)\.com$/.test(u.domain))?.expandedUrl;
      const img = it.media.find((m) => m.type === "photo")?.url ?? it.media[0]?.previewUrl;
      if (url) {
        const f = await d.enrichUrl(url, { fetchImpl: d.fetchImpl, firecrawlKey: env().FIRECRAWL_API_KEY, userAgent: USER_AGENT });
        if (f.deferred) { out.deferred++; continue; }
        doc = { ...doc, source: f.source, title: f.title, excerpt: f.excerpt, ogImage: f.ogImage, thin: f.thin };
      }
      if (img) {
        const v = await d.describeImage(img);
        doc = { ...doc, transcript: v.vision.transcript, imageDescription: v.vision.description, title: (doc.title as string | undefined) ?? v.vision.title, thumbUrl: v.thumbUrl, originalMediaUrl: v.originalMediaUrl, thin: false };
      }
      await c.enrichment.updateOne({ xId: it.xId }, { $set: doc }, { upsert: true });
      await c.items.updateOne({ xId: it.xId }, { $set: { stage: "enriched" }, $unset: { stageError: "" } }); out.done++;
    } catch (e) { out.errors++; await c.items.updateOne({ xId: it.xId }, { $set: { stageError: `enrich: ${String(e).slice(0, 300)}` } }); }
  }
  return out;
}

/** enriched → normalized (or → graded with needsContent when there is nothing to say). */
export async function stageNormalize(d: StageDeps, limit: number) {
  const c = collections(d.db); const out = { done: 0, empty: 0, errors: 0 };
  const todo = await c.items.find({ stage: "enriched" }).sort({ createdAt: 1 }).limit(limit).toArray();
  for (const it of todo) {
    try {
      const en = (await c.enrichment.findOne({ xId: it.xId })) ?? {}; const parent = it.parentId ? await c.items.findOne({ xId: it.parentId }) : null;
      const n = await d.normalizeItem(it, en, parent);
      if (!n) { out.empty++; await c.enrichment.updateOne({ xId: it.xId }, { $set: { needsContent: true } }, { upsert: true }); await c.items.updateOne({ xId: it.xId }, { $set: { stage: "graded" } }); continue; }
      await c.enrichment.updateOne({ xId: it.xId }, { $set: { normalized: n, needsContent: false } }, { upsert: true });
      await c.items.updateOne({ xId: it.xId }, { $set: { stage: "normalized" }, $unset: { stageError: "" } }); out.done++;
    } catch (e) { out.errors++; await c.items.updateOne({ xId: it.xId }, { $set: { stageError: `normalize: ${String(e).slice(0, 300)}` } }); }
  }
  return out;
}

/** normalized → embedded. Skips the API when the input hash is unchanged. */
export async function stageEmbed(d: StageDeps, limit: number) {
  const c = collections(d.db); const todo = await c.items.find({ stage: "normalized" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  const ens = new Map((await c.enrichment.find({ xId: { $in: todo.map((t) => t.xId) } }).toArray()).map((e) => [e.xId, e]));
  const model = env().EMBEDDING_MODEL, dims = env().EMBEDDING_DIMS;
  const work = todo.flatMap((it) => { const n = ens.get(it.xId)?.normalized; if (!n) return []; const input = embeddingInput(n); return [{ it, input, hash: sha256(`${model}|${dims}|${input}`) }]; });
  const existing = new Map((await c.vectors.find({ xId: { $in: work.map((w) => w.it.xId) } }).toArray()).map((v) => [v.xId, v.inputHash]));
  const need = work.filter((w) => existing.get(w.it.xId) !== w.hash);
  const vecs = need.length ? await d.embedTexts(need.map((w) => w.input)) : [];
  for (let i = 0; i < need.length; i++) await c.vectors.updateOne({ xId: need[i].it.xId }, { $set: { embedding: vecs[i], model, dims, inputHash: need[i].hash } }, { upsert: true });
  for (const w of work) { await c.items.updateOne({ xId: w.it.xId }, { $set: { stage: "embedded" } }); done++; }
  return { done };
}

/** embedded → placed. Requires a published layout; new points are appended to it (single source of truth). */
export async function stagePlace(d: StageDeps, limit: number) {
  const c = collections(d.db); const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } });
  if (!layout) return { done: 0, skippedNoLayout: true };
  const todo = await c.items.find({ stage: "embedded" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  const have = new Set(layout.points.map((p) => p.xId));
  for (const it of todo) {
    if (!have.has(it.xId)) {
      if (layout.points.length === 0) break; // nothing to snap to; wait for the batch job
      const v = await c.vectors.findOne({ xId: it.xId }); if (!v) continue;
      const p = await d.placeItem(d.db, it.xId, v.embedding, layout);
      await c.layouts.updateOne({ version: layout.version }, { $push: { points: p } }); layout.points.push(p); have.add(p.xId);
    }
    await c.items.updateOne({ xId: it.xId }, { $set: { stage: "placed" } }); done++;
  }
  return { done, skippedNoLayout: false };
}

/** placed → graded. The research-question post is never graded. */
export async function stageGrade(d: StageDeps, limit: number) {
  const c = collections(d.db); const questions = await c.questions.find({ validTo: null }).toArray();
  const todo = await c.items.find({ stage: "placed" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  for (const it of todo) {
    if (!it.isResearchQuestion) {
      const en = await c.enrichment.findOne({ xId: it.xId }); const v = await c.vectors.findOne({ xId: it.xId });
      if (en?.normalized && v) {
        const { relations } = await d.gradeItem(it, en.normalized, v.embedding, questions);
        for (const r of relations) await c.relations.updateOne({ xId: r.xId, questionId: r.questionId }, { $set: r }, { upsert: true });
      }
    }
    await c.items.updateOne({ xId: it.xId }, { $set: { stage: "graded" } }); done++;
  }
  return { done };
}
