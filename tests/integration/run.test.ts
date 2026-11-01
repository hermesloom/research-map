import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
const uri = process.env.MONGODB_URI_TEST; const d = uri ? describe : describe.skip;

d("runDaily", () => {
  let db: any, mod: typeof import("@/lib/pipeline/run"), dbmod: typeof import("@/lib/db");
  const payload = JSON.parse(fs.readFileSync("tests/fixtures/timeline-sample.json", "utf8"));
  const fakeDeps = () => ({
    fetchNewPosts: async () => ({ payload, requests: 1 }),
    fetchImpl: (async () => new Response("{}", { status: 500 })) as any,
    enrichUrl: async (url: string) => ({ source: "thin" as const, title: url, thin: true }),
    describeImage: async () => ({ vision: { transcript: "OCR TEXT", kind: "screenshot_text", description: "d", title: "t" }, thumbUrl: "https://b/t.jpg", originalMediaUrl: "https://b/o.jpg" }),
    normalizeItem: async (item: any, enrich: any) => (item.text.replace(/https?:\/\/\S+/g, "").trim() || enrich.transcript || enrich.title) ? { title: "T " + item.xId, summaryEn: "S", gist: "G", tagsEn: ["x"], language: "en", entities: [], contentKind: "thought" } : null,
    embedTexts: async (t: string[]) => t.map((_, i) => [1, i % 3, 0]),
    gradeItem: async (item: any) => ({ relations: [{ xId: item.xId, questionId: "core", role: "example", grade: 2, rationale: "r", cosine: 0.2, modelVersion: "m", disagreement: false }], cosineToCore: 0.2 }),
    placeItem: async (_db: any, xId: string) => ({ xId, x: 1, y: 1, clusterId: 0, provisional: true }),
    publish: async () => ({ _id: "current", layoutVersion: 1, pointsUrl: "p", metaUrl: "m", labelsUrl: "l", generatedAt: new Date(), count: 1, embeddingModel: "e" }),
  });
  beforeAll(async () => {
    process.env.MONGODB_URI = uri!; process.env.MONGODB_DB = "research_map_test_run"; process.env.OPENAI_API_KEY = "x";
    dbmod = await import("@/lib/db"); mod = await import("@/lib/pipeline/run"); db = await dbmod.getDb();
    for (const c of await db.collections()) await c.drop().catch(() => {});
    await dbmod.ensureIndexes(db);
    await dbmod.collections(db).questions.insertOne({ _id: "core", text: "Q", parentId: null, embedding: [1, 0, 0], validFrom: new Date(), validTo: null, origin: "seed" } as any);
  });
  afterAll(async () => { for (const c of await db.collections()) await c.drop().catch(() => {}); await dbmod.closeDb(); });

  it("run without published layout skips placement and still succeeds", async () => {
    const run = await mod.runDaily(db, fakeDeps() as any);
    expect(run.ok).toBe(true); expect(run.counts.ingested).toBe(payload.data.length);
    const { items } = dbmod.collections(db);
    expect(await items.countDocuments({ stage: "embedded" })).toBeGreaterThan(0);
    expect(await items.countDocuments({ stage: "placed" })).toBe(0);
    expect(run.notes.join(" ")).toMatch(/no published layout/i);
  });
  it("is idempotent: a second run ingests nothing new and changes nothing", async () => {
    const before = await dbmod.collections(db).items.find({}, { projection: { xId: 1, stage: 1 } }).toArray();
    const run = await mod.runDaily(db, { ...fakeDeps(), fetchNewPosts: async () => ({ payload: { data: [] }, requests: 1 }) } as any);
    expect(run.counts.ingested).toBe(0);
    const after = await dbmod.collections(db).items.find({}, { projection: { xId: 1, stage: 1 } }).toArray(); expect(after).toEqual(before);
  });
  it("places and grades once a published layout exists", async () => {
    const { layouts, items, vectors, relations } = dbmod.collections(db);
    const embedded = await items.find({ stage: "embedded" }).toArray();
    await layouts.insertOne({ version: 1, createdAt: new Date(), method: "test", status: "published", procrustesResidual: 0, labels: [], themes: [], clusters: [], hulls: [],
      points: embedded.map((it, i) => ({ xId: it.xId, x: i, y: 0, clusterId: 0, provisional: false })) } as any);
    const run = await mod.runDaily(db, { ...fakeDeps(), fetchNewPosts: async () => ({ payload: { data: [] }, requests: 1 }) } as any);
    expect(run.ok).toBe(true); expect(await items.countDocuments({ stage: "embedded" })).toBe(0); expect(await items.countDocuments({ stage: "placed" })).toBe(0);
    expect(await relations.countDocuments({ questionId: "core" })).toBe(embedded.filter((it) => !it.isResearchQuestion).length);
    expect(await vectors.countDocuments({})).toBe(embedded.length); expect(run.counts.published).toBeGreaterThan(0);
  });
  it("excludes replies to others and retweets from enrichment", async () => {
    const { enrichment, items } = dbmod.collections(db);
    const ro = await items.find({ kind: { $in: ["replyToOther", "retweet"] } }).toArray();
    expect(ro.length).toBeGreaterThan(0); expect(ro.every((i) => i.stage === "graded")).toBe(true);
    expect(await enrichment.countDocuments({ xId: { $in: ro.map((i) => i.xId) } })).toBe(0);
  });
  it("watermark is the numerically largest xId", async () => {
    const w = await mod.watermark(db); const ids = payload.data.map((t: any) => BigInt(t.id)); expect(BigInt(w!)).toBe(ids.reduce((a: bigint, b: bigint) => (a > b ? a : b)));
  });
});
