import type { AdapterCtx } from "./types";
export async function waybackUrl(url: string, ctx: AdapterCtx): Promise<string | null> {
  const res = await ctx.fetchImpl(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const j = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
  return j.archived_snapshots?.closest?.available ? j.archived_snapshots.closest.url ?? null : null;
}
