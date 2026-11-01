import type { Adapter } from "./types"; import { wikipediaTitle } from "./router";
export const fetchWikipedia: Adapter = async (url, ctx) => {
  const w = wikipediaTitle(url); if (!w) return null;
  const res = await ctx.fetchImpl(`https://${w.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.title)}`, { headers: { "User-Agent": ctx.userAgent, Accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; description?: string; extract?: string; thumbnail?: { source?: string }; lang?: string };
  if (!j.extract) return null;
  return { source: "wikipedia", title: j.title, excerpt: [j.description, j.extract].filter(Boolean).join(" — ").slice(0, 1500), ogImage: j.thumbnail?.source, language: j.lang ?? w.lang, thin: false };
};
