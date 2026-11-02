import { describe, it, expect, beforeEach } from "vitest";
import { stageEnrich, ENRICH_MAX_DEFERRALS } from "@/lib/pipeline/stages";
import type { StageDeps } from "@/lib/pipeline/stages";
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; });

/** In-memory stand-in for the two collections stageEnrich touches. */
function fakeDb(items: Record<string, unknown>[]) {
  const enrichment: Record<string, unknown>[] = [];
  const apply = (doc: Record<string, unknown>, u: Record<string, Record<string, unknown>>) => { Object.assign(doc, u.$set ?? {}); for (const k of Object.keys(u.$unset ?? {})) delete doc[k]; for (const [k, v] of Object.entries(u.$inc ?? {})) doc[k] = ((doc[k] as number) ?? 0) + (v as number); };
  const match = (doc: Record<string, unknown>, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "$in" in (v as object)) ? ((v as { $in: unknown[] }).$in).includes(doc[k]) : doc[k] === v);
  const col = (rows: Record<string, unknown>[]) => ({
    find: (q: Record<string, unknown>) => ({ sort: () => ({ limit: (n: number) => ({ toArray: async () => rows.filter((r) => match(r, q)).slice(0, n).map((r) => ({ ...r })) }) }) }),
    updateMany: async (q: Record<string, unknown>, u: Record<string, Record<string, unknown>>) => { for (const r of rows.filter((r) => match(r, q))) apply(r, u); },
    updateOne: async (q: Record<string, unknown>, u: Record<string, Record<string, unknown>>, o?: { upsert?: boolean }) => { const r = rows.find((r) => match(r, q)); if (r) apply(r, u); else if (o?.upsert) { const d = { ...q }; apply(d, u); rows.push(d); } },
  });
  return { db: { collection: (name: string) => (name === "items" ? col(items) : col(enrichment)) } as unknown as StageDeps["db"], items, enrichment };
}
const item = (xId: string, createdAt: string, extra: Record<string, unknown> = {}) => ({ xId, text: "", createdAt: new Date(createdAt), kind: "link", urls: [{ url: "https://t.co/x", expandedUrl: "https://www.cs.cmu.edu/~crary/Landin66.pdf", domain: "cs.cmu.edu", isMedia: false }], media: [], stage: "ingested", ...extra });
const now = new Date("2026-11-03T04:00:00Z");
const deps = (db: StageDeps["db"], enrichUrl: StageDeps["enrichUrl"]): StageDeps => ({ db, fetchImpl: fetch, enrichUrl, describeImage: async () => { throw new Error("unused"); }, normalizeItem: null as never, embedTexts: null as never, gradeItem: null as never, placeItem: null as never, now: () => now, log: () => {} });

describe("stageEnrich deferrals", () => {
  it("records the reason on the item, counts quota and transient separately, and does not advance the stage", async () => {
    const f = fakeDb([item("1", "2026-11-02T16:00:00Z"), item("2", "2026-11-02T17:00:00Z")]); let n = 0;
    const r = await stageEnrich(deps(f.db, async () => (n++ === 0 ? { source: "none", thin: true, deferred: "transient", reason: "timeout after 25000ms" } : { source: "none", thin: true, deferred: "quota", reason: "firecrawl credits exhausted" })), 10);
    expect(r).toMatchObject({ done: 0, deferred: 2, deferredQuota: 1, deferredTransient: 1, errors: 0 });
    expect(f.items[0]).toMatchObject({ stage: "ingested", enrichDeferrals: 1, stageError: "enrich deferred (transient): timeout after 25000ms" }); expect(f.items[1].stageError).toMatch(/quota/); expect(f.enrichment).toHaveLength(0);
  });
  it("passes giveUp once the item has been deferred ENRICH_MAX_DEFERRALS times", async () => {
    const f = fakeDb([item("1", "2026-11-02T16:00:00Z", { enrichDeferrals: ENRICH_MAX_DEFERRALS })]); const seen: boolean[] = [];
    const r = await stageEnrich(deps(f.db, async (_u, ctx) => { seen.push(!!ctx.giveUp); return { source: "thin", title: "cs.cmu.edu · ~crary Landin66", thin: true }; }), 10);
    expect(seen).toEqual([true]); expect(r.done).toBe(1); expect(f.items[0]).toMatchObject({ stage: "enriched" }); expect(f.items[0].enrichDeferrals).toBeUndefined(); expect(f.items[0].stageError).toBeUndefined(); expect(f.enrichment[0]).toMatchObject({ source: "thin", title: "cs.cmu.edu · ~crary Landin66" });
  });
  it("passes giveUp for a post older than 48 h even without recorded deferrals, and not for a fresh one", async () => {
    const f = fakeDb([item("old", "2026-11-01T00:00:00Z"), item("new", "2026-11-02T20:00:00Z")]); const seen: Record<string, boolean> = {};
    await stageEnrich(deps(f.db, async (u, ctx) => { seen[u.includes("Landin") ? (ctx.giveUp ? "old" : "new") : "?"] = !!ctx.giveUp; return { source: "thin", title: "t", thin: true }; }), 10);
    expect(seen).toEqual({ old: true, new: false });
  });
});
