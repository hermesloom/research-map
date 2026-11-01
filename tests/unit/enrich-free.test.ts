import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fetchWikipedia } from "@/lib/enrich/wikipedia";
import { fetchYoutube } from "@/lib/enrich/youtube";
import { fetchGithub } from "@/lib/enrich/github";
const fx = (n: string) => fs.readFileSync(`tests/fixtures/enrich/${n}`, "utf8");
const ctx = (body: string, status = 200) => ({ fetchImpl: (async () => new Response(body, { status })) as any, userAgent: "test" });

describe("free adapters", () => {
  it("wikipedia returns title + extract and sets language", async () => {
    const r = await fetchWikipedia("https://en.wikipedia.org/wiki/Yoneda_lemma", ctx(fx("wikipedia-en.json")));
    expect(r!.source).toBe("wikipedia"); expect(r!.title).toMatch(/Yoneda/); expect(r!.excerpt!.length).toBeGreaterThan(100); expect(r!.language).toBe("en"); expect(r!.thin).toBe(false);
  });
  it("wikipedia returns null on 404", async () => { expect(await fetchWikipedia("https://en.wikipedia.org/wiki/Nope_nope", ctx("{}", 404))).toBeNull(); });
  it("youtube oembed returns title + author as excerpt", async () => {
    const r = await fetchYoutube("https://www.youtube.com/watch?v=tETbivwzXBM", ctx(fx("youtube-oembed.json")));
    expect(r!.source).toBe("oembed"); expect(r!.title).toBeTruthy(); expect(r!.excerpt).toMatch(/by /); expect(r!.ogImage).toMatch(/ytimg/);
  });
  it("github returns description + topics", async () => {
    const r = await fetchGithub("https://github.com/apple/embedding-atlas", ctx(fx("github-repo.json")));
    expect(r!.source).toBe("github"); expect(r!.title).toBe("apple/embedding-atlas"); expect(r!.excerpt).toMatch(/embedding/i);
  });
});
