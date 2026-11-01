import type { AdapterCtx, Fetched } from "./types"; import { routeHost } from "./router";
import { fetchWikipedia } from "./wikipedia"; import { fetchYoutube } from "./youtube"; import { fetchGithub } from "./github";
import { fetchArxiv } from "./arxiv"; import { fetchOpenAlex } from "./openalex"; import { fetchFirecrawl, QuotaExhausted } from "./firecrawl"; import { waybackUrl } from "./wayback";

export function thinRecord(url: string): Fetched {
  let u: URL; try { u = new URL(url); } catch { return { source: "thin", title: url.slice(0, 80), thin: true }; }
  const words = u.pathname.split(/[\/._\-%+]+/).filter((w) => w && !/^\d+$/.test(w) && !/^(pdf|html|htm|php)$/i.test(w)).join(" ");
  return { source: "thin", title: `${u.hostname.replace(/^www\./, "")}${words ? ` · ${words}` : ""}`.slice(0, 120), thin: true };
}
const safe = async (f: () => Promise<Fetched | null>) => { try { return await f(); } catch (e) { if (e instanceof QuotaExhausted) throw e; return null; } };

/** Never throws, never returns null. `deferred` means Firecrawl credits ran out: retry on a later run. */
export async function enrichUrl(url: string, ctx: AdapterCtx): Promise<Fetched & { deferred?: boolean }> {
  const host = routeHost(url);
  const order: Array<() => Promise<Fetched | null>> = [];
  if (host === "wikipedia") order.push(() => fetchWikipedia(url, ctx));
  if (host === "youtube") order.push(() => fetchYoutube(url, ctx));
  if (host === "arxiv") order.push(() => fetchArxiv(url, ctx));
  if (host === "github") order.push(() => fetchGithub(url, ctx));
  if (host === "doi") order.push(() => fetchOpenAlex(url, ctx));
  order.push(() => fetchFirecrawl(url, ctx));
  if (host !== "doi") order.push(() => fetchOpenAlex(url, ctx)); // a DOI may still be embedded in the url
  order.push(async () => { const w = await waybackUrl(url, ctx); return w ? fetchFirecrawl(w, ctx) : null; });
  try {
    for (const step of order) { const r = await safe(step); if (r && (r.title || r.excerpt)) return r; }
  } catch (e) {
    if (e instanceof QuotaExhausted) return { source: "none", thin: true, deferred: true };
    throw e;
  }
  return thinRecord(url);
}
