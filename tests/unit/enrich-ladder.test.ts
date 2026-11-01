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
    const dead = seq([[500, "{}"], [200, JSON.stringify({ archived_snapshots: {} })]]);
    const r = await enrichUrl("https://dead.example.org/some/long-path-name", { fetchImpl: dead, userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("thin"); expect(r.thin).toBe(true); expect(r.title).toMatch(/dead\.example\.org/); expect(r.title).toMatch(/long path name/);
  });
  it("defers (source none) when firecrawl quota is exhausted", async () => {
    const r = await enrichUrl("https://xtdb.com/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("none"); expect((r as any).deferred).toBe(true);
  });
  it("thinRecord humanizes the path", () => { expect(thinRecord("https://foo.org/a_b-c/d.pdf").title).toBe("foo.org · a b c d"); });
});
