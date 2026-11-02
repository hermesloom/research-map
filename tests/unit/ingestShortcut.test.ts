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
  const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  it("sends the secret as bearer and summarises the run", async () => {
    const f = vi.fn<typeof fetch>(json(200, { ok: true, counts: { ingested: 2, published: 140 }, errors: [], notes: ["relayoutRecommended"] }));
    const r = await runIngest("s3cret", f as unknown as typeof fetch);
    expect(f.mock.calls[0][0]).toBe("/api/cron/ingest"); expect(f.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer s3cret" });
    expect(r).toEqual({ ok: true, message: "Ingest done: ingested 2, published 140\nrelayoutRecommended" });
  });
  it("maps 401, errors and network failures", async () => {
    expect(await runIngest("x", json(401, "unauthorized") as unknown as typeof fetch)).toEqual({ ok: false, message: "Wrong key." });
    expect((await runIngest("x", json(500, { ok: false, counts: {}, errors: ["X down"], notes: [] }) as unknown as typeof fetch)).message).toBe("Ingest finished with errors: nothing changed\nerror: X down");
    expect((await runIngest("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).message).toMatch(/offline/);
    expect((await runIngest("x", (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch)).message).toBe("Ingest failed: HTTP 502");
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
