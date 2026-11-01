import type { Db } from "mongodb";
import { collections } from "./db";
import { buildSnapshot } from "./snapshot";
import { putPublic } from "./blob";
import { env } from "./env";
import type { Manifest, Relation } from "./types";

/** Build and upload an immutable snapshot of the latest published layout; point the manifest at it. */
export async function publishSnapshot(db: Db, deps = { put: putPublic }): Promise<Manifest> {
  const c = collections(db);
  const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } }); if (!layout) throw new Error("no published layout");
  const [items, enr, rels, questions, overrides] = await Promise.all([
    c.items.find({ kind: { $nin: ["replyToOther", "retweet"] } }).toArray(), c.enrichment.find({}).toArray(), c.relations.find({}).toArray(), c.questions.find({}).toArray(), c.overrides.find({}).toArray(),
  ]);
  const relMap = new Map<string, Relation[]>(); for (const r of rels) relMap.set(r.xId, [...(relMap.get(r.xId) ?? []), r]);
  const generatedAt = new Date();
  const snap = buildSnapshot({ layout, items, enrichment: new Map(enr.map((e) => [e.xId, e])), relations: relMap, questions, overrides, generatedAt });
  const dir = `canvas/${generatedAt.toISOString().replace(/[:.]/g, "-")}`;
  const [pointsUrl, metaUrl, labelsUrl] = await Promise.all([
    deps.put(`${dir}/points.json`, JSON.stringify(snap.points), "application/json"),
    deps.put(`${dir}/meta.json`, JSON.stringify(snap.meta), "application/json"),
    deps.put(`${dir}/labels.json`, JSON.stringify(snap.labels), "application/json"),
  ]);
  const manifest: Manifest = { _id: "current", layoutVersion: layout.version, pointsUrl, metaUrl, labelsUrl, generatedAt, count: snap.points.count, embeddingModel: `${env().EMBEDDING_MODEL}@${env().EMBEDDING_DIMS}` };
  await c.manifest.replaceOne({ _id: "current" }, manifest, { upsert: true });
  return manifest;
}
