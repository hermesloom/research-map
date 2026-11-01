import { MongoClient, type Db } from "mongodb";
import { env } from "./env";
import type { Item, Enrichment, VectorDoc, Question, Relation, Layout, Manifest, RunDoc, Override } from "./types";

let client: MongoClient | null = null;
export async function getDb(): Promise<Db> {
  if (!client) { client = new MongoClient(env().MONGODB_URI, { maxPoolSize: 5 }); await client.connect(); }
  return client.db(env().MONGODB_DB);
}
export async function closeDb() { await client?.close(); client = null; }

export function collections(db: Db) {
  return {
    items: db.collection<Item>("items"),
    enrichment: db.collection<Enrichment>("enrichment"),
    vectors: db.collection<VectorDoc>("vectors"),
    facets: db.collection("facets"),
    assignments: db.collection("assignments"),
    questions: db.collection<Question>("questions"),
    relations: db.collection<Relation>("relations"),
    layouts: db.collection<Layout>("layouts"),
    lenses: db.collection("lenses"),
    trails: db.collection("trails"),
    overrides: db.collection<Override>("overrides"),
    runs: db.collection<RunDoc>("runs"),
    manifest: db.collection<Manifest>("manifest"),
  };
}
export type Collections = ReturnType<typeof collections>;

export async function ensureIndexes(db: Db) {
  const c = collections(db);
  await c.items.createIndex({ xId: 1 }, { unique: true });
  await c.items.createIndex({ stage: 1, createdAt: 1 });
  await c.items.createIndex({ createdAt: -1 });
  await c.enrichment.createIndex({ xId: 1 }, { unique: true });
  await c.vectors.createIndex({ xId: 1 }, { unique: true });
  await c.relations.createIndex({ xId: 1, questionId: 1 }, { unique: true });
  await c.layouts.createIndex({ version: -1 }, { unique: true });
  await c.layouts.createIndex({ status: 1, version: -1 });
  await c.runs.createIndex({ startedAt: -1 });
  await c.overrides.createIndex({ type: 1, xId: 1, clusterId: 1 });
}

/** Atlas Vector Search index on vectors.embedding. No-op if it exists. Requires Atlas (not local mongod). */
export async function ensureVectorIndex(db: Db, dims: number) {
  const col = db.collection("vectors");
  const existing = await col.listSearchIndexes().toArray().catch(() => [] as { name?: string }[]);
  if (existing.some((i) => i.name === "embedding_idx")) return;
  await col.createSearchIndex({
    name: "embedding_idx", type: "vectorSearch",
    definition: { fields: [{ type: "vector", path: "embedding", numDimensions: dims, similarity: "cosine" }] },
  });
}
