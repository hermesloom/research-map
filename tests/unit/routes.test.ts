import { describe, it, expect, vi, beforeEach } from "vitest";
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; process.env.CRON_SECRET = "s3cret"; vi.resetModules(); });

describe("cron route auth", () => {
  it("rejects missing or wrong bearer", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}) })); vi.doMock("@/lib/pipeline/run", () => ({ runDaily: async () => ({ ok: true }) }));
    const { GET } = await import("@/app/api/cron/ingest/route");
    expect((await GET(new Request("http://x/api/cron/ingest"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/ingest", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
  it("runs with the right bearer and returns the run", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}) })); vi.doMock("@/lib/pipeline/run", () => ({ runDaily: async () => ({ ok: true, notes: [], counts: { ingested: 2 } }) })); vi.doMock("@/lib/pipeline/reconcile", () => ({ reconcileDeletions: async () => ({}) }));
    const { GET } = await import("@/app/api/cron/ingest/route");
    const res = await GET(new Request("http://x/api/cron/ingest", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200); expect((await res.json()).counts.ingested).toBe(2);
  });
});
describe("manifest route caching", () => {
  it("sets s-maxage and swr", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ manifest: { findOne: async () => ({ _id: "current", count: 1 }) } }) }));
    const { GET } = await import("@/app/api/manifest/route"); const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/); expect(res.headers.get("cache-control")).toMatch(/stale-while-revalidate/);
  });
});
describe("reconcile", () => {
  it("tombstones items missing from the 14-day window and revives reappearing ones", async () => {
    vi.doUnmock("@/lib/pipeline/reconcile"); const { diffDeletions } = await import("@/lib/pipeline/reconcile");
    const now = new Date("2026-11-08T00:00:00Z"); const recent = new Date("2026-11-01T00:00:00Z"); const old = new Date("2026-09-01T00:00:00Z");
    const local = [{ xId: "1", createdAt: recent }, { xId: "2", createdAt: recent, deletedAt: now }, { xId: "3", createdAt: old }];
    const r = diffDeletions(local as any, ["2"], now);
    expect(r.toDelete).toEqual(["1"]); expect(r.toRevive).toEqual(["2"]);
  });
});
