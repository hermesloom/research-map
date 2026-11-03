import { describe, it, expect, vi } from "vitest";
import { doubleShift } from "@/app/canvas/shortcuts";
import { runIngest, manifestUrl, FRESH_KEY } from "@/app/canvas/ingest";

describe("doubleShift", () => {
  it("fires only on two Shift+key presses within the window, then re-arms", () => {
    let t = 1000; const fire = vi.fn(); const h = doubleShift("i", fire, 600, () => t);
    h({ shiftKey: true, key: "I" }); t = 1500; h({ shiftKey: true, key: "i" }); expect(fire).toHaveBeenCalledTimes(1);
    t = 1900; h({ shiftKey: true, key: "i" }); expect(fire).toHaveBeenCalledTimes(1);           // third press starts a new pair
    t = 3000; h({ shiftKey: true, key: "i" }); t = 3300; h({ shiftKey: false, key: "i" }); expect(fire).toHaveBeenCalledTimes(1); // no shift
    t = 3400; h({ shiftKey: true, key: "o" }); t = 3500; h({ shiftKey: true, key: "i" }); expect(fire).toHaveBeenCalledTimes(2);
  });
});
describe("runIngest", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const finished = { ok: true, counts: { ingested: 2, published: 140 }, errors: [], notes: ["relevantNote"], startedAt: "2026-11-03T22:00:00.000Z", finishedAt: "2026-11-03T22:01:30.000Z" };
  /** A fake server: POST starts a run, GET answers with whatever the script says next. */
  const server = (polls: unknown[], startStatus = 202) => {
    const f = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST" ? json(startStatus, { startedAt: "2026-11-03T22:00:00.000Z" }) : json(200, { run: polls.shift() ?? null }));
    return f as unknown as typeof fetch & { mock: { calls: Array<[string, RequestInit?]> } };
  };
  const quiet = { sleep: async () => {}, pollMs: 1 };
  it("starts the run with the secret as bearer, polls until finishedAt and summarises", async () => {
    const f = server([null, { ...finished, finishedAt: undefined }, finished]);
    const r = await runIngest("s3cret", f, quiet);
    expect(f.mock.calls[0]).toEqual(["/api/cron/ingest/manual", { method: "POST", headers: { authorization: "Bearer s3cret" } }]);
    expect(f.mock.calls[1][0]).toBe("/api/cron/ingest/manual?since=2026-11-03T22%3A00%3A00.000Z"); expect(f.mock.calls[1][1]?.headers).toEqual({ authorization: "Bearer s3cret" });
    expect(f).toHaveBeenCalledTimes(4);
    expect(r).toEqual({ ok: true, message: "Ingest done: ingested 2, published 140\nrelevantNote" });
  });
  it("keeps polling through a transient network blip", async () => {
    let n = 0;
    const f = vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === "POST") return json(202, { startedAt: "2026-11-03T22:00:00.000Z" }); if (n++ === 0) throw new Error("offline"); return json(200, { run: finished }); });
    expect((await runIngest("x", f as unknown as typeof fetch, quiet)).ok).toBe(true);
  });
  it("maps 401, a failed run, a start failure and a run that outlives the wait", async () => {
    expect(await runIngest("x", server([], 401), quiet)).toEqual({ ok: false, message: "Wrong key." });
    expect(await runIngest("x", server([], 502), quiet)).toEqual({ ok: false, message: "Ingest failed: HTTP 502" });
    expect((await runIngest("x", server([{ ...finished, ok: false, counts: {}, errors: ["X down"], notes: [] }]), quiet)).message).toBe("Ingest finished with errors: nothing changed\nerror: X down");
    expect((await runIngest("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch, quiet)).message).toMatch(/Ingest request failed.*offline/);
    let t = 0; const r = await runIngest("x", server([null, null, null]), { ...quiet, timeoutMs: 100, now: () => (t += 60) });
    expect(r.ok).toBe(false); expect(r.message).toMatch(/still running/);
  });
});
describe("manifestUrl", () => {
  it("busts the cache once after a manual ingest and leaves the URL alone otherwise", () => {
    const store = new Map<string, string>([[FRESH_KEY, "1"]]); const st = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => { store.delete(k); } };
    expect(manifestUrl("/api/manifest", st, () => 42)).toBe("/api/manifest?t=42"); expect(manifestUrl("/api/manifest", st, () => 43)).toBe("/api/manifest");
    expect(manifestUrl("/dev.json?x=1", { getItem: () => "1", removeItem: () => {} }, () => 7)).toBe("/dev.json?x=1&t=7");
    expect(manifestUrl("/api/manifest", null)).toBe("/api/manifest"); expect(manifestUrl("/api/manifest", { getItem: () => { throw new Error("blocked"); }, removeItem: () => {} })).toBe("/api/manifest");
  });
});
