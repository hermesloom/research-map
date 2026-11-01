import { describe, it, expect, beforeAll, afterAll } from "vitest";
const uri = process.env.MONGODB_URI_TEST;
const d = uri ? describe : describe.skip;

d("db", () => {
  let mod: typeof import("@/lib/db");
  beforeAll(async () => {
    process.env.MONGODB_URI = uri!; process.env.MONGODB_DB = "research_map_test"; process.env.OPENAI_API_KEY = "x";
    mod = await import("@/lib/db");
  });
  afterAll(async () => { const db = await mod.getDb(); for (const c of await db.collections()) await c.drop().catch(() => {}); await mod.closeDb(); });

  it("creates unique xId indexes and upserts idempotently", async () => {
    const db = await mod.getDb(); await mod.ensureIndexes(db);
    const { items } = mod.collections(db);
    const doc = { xId: "1", text: "a", createdAt: new Date(), kind: "text", urls: [], media: [], isResearchQuestion: false, stage: "ingested", fetchedAt: new Date() } satisfies import("@/lib/types").Item;
    await items.updateOne({ xId: "1" }, { $setOnInsert: doc }, { upsert: true });
    await items.updateOne({ xId: "1" }, { $setOnInsert: doc }, { upsert: true });
    expect(await items.countDocuments({ xId: "1" })).toBe(1);
    const idx = await items.indexes();
    expect(idx.some((i) => i.unique && i.key.xId === 1)).toBe(true);
  });
});
