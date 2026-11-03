import { describe, it, expect, vi, beforeEach } from "vitest";
const scheduled: Array<() => Promise<unknown>> = [];
vi.mock("next/server", () => ({ connection: async () => {}, after: (fn: () => Promise<unknown>) => { scheduled.push(fn); } }));
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; process.env.CRON_SECRET = "s3cret"; scheduled.length = 0; vi.resetModules(); });

const H = { authorization: "Bearer s3cret" };
const post = (headers: Record<string, string> = H) => new Request("http://x/api/cron/ingest/manual", { method: "POST", headers });
const get = (since: string, headers: Record<string, string> = H) => new Request(`http://x/api/cron/ingest/manual?since=${encodeURIComponent(since)}`, { headers });

function mockDb(runs: { findOne: (...a: unknown[]) => Promise<unknown> }, job = vi.fn(async () => ({ ok: true }))) {
  vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ runs }) }));
  vi.doMock("@/lib/pipeline/job", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pipeline/job")>()), dailyJob: job }));
  return job;
}

describe("manual ingest route", () => {
  it("rejects a missing or wrong bearer on both verbs", async () => {
    mockDb({ findOne: async () => null });
    const { POST, GET } = await import("@/app/api/cron/ingest/manual/route");
    expect((await POST(post({}))).status).toBe(401); expect((await POST(post({ authorization: "Bearer nope" }))).status).toBe(401);
    expect((await GET(get("2026-11-03T22:00:00.000Z", {}))).status).toBe(401);
    expect(scheduled).toHaveLength(0);
  });
  it("POST answers at once with a start time and runs the daily job after the response", async () => {
    const job = mockDb({ findOne: async () => null });
    const { POST } = await import("@/app/api/cron/ingest/manual/route");
    const before = Date.now(); const res = await POST(post()); const body = await res.json();
    expect(res.status).toBe(202); expect(Date.parse(body.startedAt)).toBeGreaterThanOrEqual(before); expect(body.attached).toBe(false);
    expect(job).not.toHaveBeenCalled(); expect(scheduled).toHaveLength(1); await scheduled[0](); expect(job).toHaveBeenCalledTimes(1);
  });
  it("POST attaches to a run that is still going instead of starting a second one", async () => {
    const running = { startedAt: new Date(Date.now() - 60_000) };
    const job = mockDb({ findOne: async (q: unknown) => ((q as { finishedAt?: unknown }).finishedAt ? running : null) });
    const { POST } = await import("@/app/api/cron/ingest/manual/route");
    const res = await POST(post()); const body = await res.json();
    expect(res.status).toBe(202); expect(body).toEqual({ startedAt: running.startedAt.toISOString(), attached: true }); expect(scheduled).toHaveLength(0); expect(job).not.toHaveBeenCalled();
  });
  it("GET reports nothing yet, running, or finished for runs started at or after `since`", async () => {
    const seen: unknown[] = []; const docs: unknown[] = [null, { startedAt: new Date("2026-11-03T22:00:00.000Z"), ok: true, counts: {}, errors: [], notes: [] }];
    mockDb({ findOne: async (q: unknown) => { seen.push(q); return docs.length ? docs.shift() : { startedAt: new Date("2026-11-03T22:00:00.000Z"), finishedAt: new Date("2026-11-03T22:01:00.000Z"), ok: true, counts: { ingested: 1 }, errors: [], notes: [] }; } });
    const { GET } = await import("@/app/api/cron/ingest/manual/route");
    const r1 = await GET(get("2026-11-03T22:00:00.000Z")); expect(r1.status).toBe(200); expect(r1.headers.get("cache-control")).toBe("no-store"); expect(await r1.json()).toEqual({ run: null });
    expect((seen[0] as { startedAt: { $gte: Date } }).startedAt.$gte.toISOString()).toBe("2026-11-03T22:00:00.000Z");
    expect((await (await GET(get("2026-11-03T22:00:00.000Z"))).json()).run.finishedAt).toBeUndefined();
    const r3 = await (await GET(get("2026-11-03T22:00:00.000Z"))).json(); expect(r3.run.finishedAt).toBe("2026-11-03T22:01:00.000Z"); expect(r3.run.counts).toEqual({ ingested: 1 });
    expect((await GET(get("not-a-date"))).status).toBe(400);
  });
});
