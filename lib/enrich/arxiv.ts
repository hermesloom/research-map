import type { Adapter } from "./types"; import { arxivId } from "./router";
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/\s+/g, " ").trim() : undefined; };
export const fetchArxiv: Adapter = async (url, ctx) => {
  const id = arxivId(url); if (!id) return null;
  const res = await ctx.fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const xml = await res.text(); const entry = xml.split("<entry>")[1]; if (!entry) return null;
  const title = tag(entry, "title"); const summary = tag(entry, "summary"); if (!title) return null;
  const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 4).join(", ");
  return { source: "arxiv", title, excerpt: [authors ? `${authors}.` : "", summary ?? ""].join(" ").trim().slice(0, 1500), thin: false };
};
