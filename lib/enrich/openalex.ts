import type { Adapter } from "./types"; import { doiOf } from "./router";
export function reconstructAbstract(inv: Record<string, number[]>): string {
  const words: string[] = []; for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w; return words.filter(Boolean).join(" ");
}
export const fetchOpenAlex: Adapter = async (url, ctx) => {
  const doi = doiOf(url); if (!doi) return null;
  const res = await ctx.fetchImpl(`https://api.openalex.org/works/https://doi.org/${doi}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; abstract_inverted_index?: Record<string, number[]> | null; publication_year?: number; primary_location?: { source?: { display_name?: string } } };
  if (!j.title) return null;
  const abs = j.abstract_inverted_index ? reconstructAbstract(j.abstract_inverted_index) : "";
  return { source: "openalex", title: j.title, excerpt: [j.primary_location?.source?.display_name, j.publication_year, abs].filter(Boolean).join(". ").slice(0, 1500) || undefined, thin: !abs };
};
