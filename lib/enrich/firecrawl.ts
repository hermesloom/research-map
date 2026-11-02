import type { Adapter } from "./types";
export class QuotaExhausted extends Error {}
/** 429 / 5xx / network failure: retry on a later run instead of caching a thin record forever. */
export class Transient extends Error {}
export const fetchFirecrawl: Adapter = async (url, ctx) => {
  if (!ctx.firecrawlKey) return null;
  const res = await ctx.fetchImpl("https://api.firecrawl.dev/v2/scrape", {
    method: "POST", headers: { Authorization: `Bearer ${ctx.firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "summary"], onlyMainContent: true, parsers: [{ type: "pdf", maxPages: 5 }], timeout: 20_000 }),   // Firecrawl gives up before our 25 s fetch abort, so a slow page yields a clean error
  });
  if (res.status === 402) throw new QuotaExhausted("firecrawl credits exhausted");
  if (res.status === 429 || res.status >= 500) throw new Transient(`firecrawl ${res.status}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { success?: boolean; data?: { markdown?: string; summary?: string; metadata?: { title?: string; description?: string; ogImage?: string; language?: string; statusCode?: number } } };
  const d = j.data; if (!j.success || !d) return null;
  const sc = d.metadata?.statusCode ?? 200; if (sc === 401 || sc === 402 || sc === 403 || sc === 404) return null;
  const body = (d.summary && d.summary.length > 40 ? d.summary : (d.markdown ?? "").replace(/\s+/g, " ").slice(0, 1200)).trim();
  if (body.length < 300 && /subscribe|sign in|log in|paywall/i.test(body)) return null;
  return { source: "firecrawl", title: d.metadata?.title, excerpt: [d.metadata?.description, body].filter(Boolean).join(" — ").slice(0, 1500) || undefined, ogImage: d.metadata?.ogImage, language: d.metadata?.language, thin: body.length < 80 };
};
