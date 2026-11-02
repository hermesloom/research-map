import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fetchArxiv } from "@/lib/enrich/arxiv";
import { fetchOpenAlex, reconstructAbstract } from "@/lib/enrich/openalex";
import { fetchFirecrawl, QuotaExhausted } from "@/lib/enrich/firecrawl";
import { enrichUrl, thinRecord } from "@/lib/enrich/ladder";
const fx = (n: string) => fs.readFileSync(`tests/fixtures/enrich/${n}`, "utf8");
const seq = (responses: Array<[number, string]>) => { let i = 0; return (async () => { const [s, b] = responses[Math.min(i++, responses.length - 1)]; return new Response(b, { status: s }); }) as any; };

describe("paper adapters", () => {
  it("arxiv parses title and abstract from Atom", async () => {
    const r = await fetchArxiv("https://arxiv.org/html/1711.07059v2", { fetchImpl: seq([[200, fx("arxiv.xml")]]), userAgent: "t" });
    expect(r!.source).toBe("arxiv"); expect(r!.title).toMatch(/open games/i); expect(r!.excerpt!.length).toBeGreaterThan(200);
  });
  it("openalex reconstructs abstract from inverted index", () => {
    expect(reconstructAbstract({ Towers: [0], of: [1], interpreters: [2] })).toBe("Towers of interpreters");
  });
  it("openalex adapter resolves a DOI url", async () => {
    const r = await fetchOpenAlex("https://dl.acm.org/doi/10.1145/3158140", { fetchImpl: seq([[200, fx("openalex.json")]]), userAgent: "t" });
    expect(r!.source).toBe("openalex"); expect(r!.title).toMatch(/interpreters/i);
  });
});

describe("firecrawl", () => {
  it("returns title + summary", async () => {
    const r = await fetchFirecrawl("https://xtdb.com/", { fetchImpl: seq([[200, fx("firecrawl-page.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r!.source).toBe("firecrawl"); expect(r!.title).toBeTruthy(); expect(r!.excerpt!.length).toBeGreaterThan(50);
  });
  it("throws QuotaExhausted on 402", async () => {
    await expect(fetchFirecrawl("https://a.b/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k" })).rejects.toBeInstanceOf(QuotaExhausted);
  });
  it("returns null without a key", async () => { expect(await fetchFirecrawl("https://a.b/", { fetchImpl: seq([[200, "{}"]]), userAgent: "t" })).toBeNull(); });
});

describe("enrichUrl ladder", () => {
  it("uses wikipedia first for wikipedia urls", async () => {
    const r = await enrichUrl("https://en.wikipedia.org/wiki/Yoneda_lemma", { fetchImpl: seq([[200, fx("wikipedia-en.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("wikipedia");
  });
  it("falls from a paywalled generic page to openalex via DOI", async () => {
    const r = await enrichUrl("https://dl.acm.org/doi/10.1145/3158140", { fetchImpl: seq([[200, fx("openalex.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("openalex");
  });
  it("falls through to wayback then thin on a dead generic page", async () => {
    // Firecrawl reaches the page but it is gone (HTTP 404 inside the scrape result); Wayback has no snapshot.
    const dead = seq([[200, JSON.stringify({ success: true, data: { metadata: { statusCode: 404 } } })], [200, JSON.stringify({ archived_snapshots: {} })]]);
    const r = await enrichUrl("https://dead.example.org/some/long-path-name", { fetchImpl: dead, userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("thin"); expect(r.thin).toBe(true); expect(r.title).toMatch(/dead\.example\.org/); expect(r.title).toMatch(/long path name/);
  });
  it("defers (source none) when firecrawl quota is exhausted", async () => {
    const r = await enrichUrl("https://xtdb.com/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("none"); expect(r.deferred).toBe("quota"); expect(r.reason).toMatch(/credits/);
  });
  it("thinRecord humanizes the path", () => { expect(thinRecord("https://foo.org/a_b-c/d.pdf").title).toBe("foo.org · a b c d"); });
});

describe("transient failures are deferred, not cached as thin", () => {
  it("firecrawl 429/5xx → deferred", async () => {
    for (const code of [429, 500, 503]) {
      const r = await enrichUrl("https://xtdb.com/", { fetchImpl: seq([[code, "{}"]]), userAgent: "t", firecrawlKey: "k" });
      expect(r.source).toBe("none"); expect(r.deferred).toBe("transient"); expect(r.reason).toBe(`firecrawl ${code}`);
    }
  });
  it("network error or timeout on the paid rung → deferred as transient with the reason", async () => {
    const boom = (async () => { throw new TypeError("fetch failed"); }) as any;
    const r = await enrichUrl("https://xtdb.com/", { fetchImpl: boom, userAgent: "t", firecrawlKey: "k" });
    expect(r.deferred).toBe("transient"); expect(r.reason).toMatch(/fetch failed/);
    const hung = (async () => { throw new Error("timeout after 25000ms"); }) as any;
    expect((await enrichUrl("https://www.cs.cmu.edu/~crary/819-f09/Landin66.pdf", { fetchImpl: hung, userAgent: "t", firecrawlKey: "k" })).reason).toMatch(/timeout after 25000ms/);
  });
  it("with giveUp, a transient Firecrawl failure skips the rung and the ladder ends in a thin record", async () => {
    const hung = (async () => { throw new Error("timeout after 25000ms"); }) as any;
    const r = await enrichUrl("https://www.cs.cmu.edu/~crary/819-f09/Landin66.pdf", { fetchImpl: hung, userAgent: "t", firecrawlKey: "k", giveUp: true });
    expect(r.deferred).toBeUndefined(); expect(r.source).toBe("thin"); expect(r.title).toBe("cs.cmu.edu · ~crary f09 Landin66");
  });
  it("with giveUp, quota exhaustion still defers (credits come back)", async () => {
    const r = await enrichUrl("https://xtdb.com/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k", giveUp: true }); expect(r.deferred).toBe("quota");
  });
  it("firecrawl asks the service for its own 20 s timeout", async () => {
    let body = ""; const spy = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response("{}", { status: 500 }); }) as any;
    await enrichUrl("https://xtdb.com/", { fetchImpl: spy, userAgent: "t", firecrawlKey: "k" }); expect(JSON.parse(body).timeout).toBe(20000);
  });
  it("a genuine 404 on a generic page still falls through to thin", async () => {
    const r = await enrichUrl("https://gone.example.org/a", { fetchImpl: seq([[404, "{}"], [200, JSON.stringify({ archived_snapshots: {} })]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("thin");
  });
});
