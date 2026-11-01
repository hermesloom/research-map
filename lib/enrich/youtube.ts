import type { Adapter } from "./types"; import { youtubeId } from "./router";
export const fetchYoutube: Adapter = async (url, ctx) => {
  const id = youtubeId(url); if (!id) return null;
  const res = await ctx.fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  if (!j.title) return null;
  return { source: "oembed", title: j.title, excerpt: `Video "${j.title}" by ${j.author_name ?? "unknown"} on YouTube.`, ogImage: j.thumbnail_url, thin: false };
};
