import type { Adapter } from "./types"; import { githubRepo } from "./router";
export const fetchGithub: Adapter = async (url, ctx) => {
  const r = githubRepo(url); if (!r) return null;
  const res = await ctx.fetchImpl(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: { "User-Agent": ctx.userAgent, Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { full_name?: string; description?: string | null; topics?: string[]; language?: string | null; stargazers_count?: number };
  const excerpt = [j.description ?? "", j.topics?.length ? `Topics: ${j.topics.join(", ")}.` : "", j.language ? `Language: ${j.language}.` : ""].filter(Boolean).join(" ").slice(0, 1000);
  return { source: "github", title: j.full_name ?? `${r.owner}/${r.repo}`, excerpt: excerpt || undefined, thin: !j.description };
};
