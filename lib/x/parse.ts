import type { Item, ItemMedia, ItemUrl, Kind } from "../types";

export interface XUrl { url: string; expanded_url?: string; unwound_url?: string; title?: string; description?: string; media_key?: string; }
export interface XTweet {
  id: string; text: string; created_at: string; lang?: string; entities?: { urls?: XUrl[] }; attachments?: { media_keys?: string[] };
  referenced_tweets?: { type: "replied_to" | "quoted" | "retweeted"; id: string }[]; in_reply_to_user_id?: string; note_tweet?: { text: string }; public_metrics?: Record<string, number>;
}
export interface XMedia { media_key: string; type: "photo" | "video" | "animated_gif"; url?: string; preview_image_url?: string; alt_text?: string; }
export interface XTimelinePayload { data?: XTweet[]; includes?: { media?: XMedia[]; tweets?: XTweet[] }; meta?: { next_token?: string; newest_id?: string; result_count?: number } }

export function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
const PHOTO_RE = /^https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\/(photo|video)\/\d+/;

export function classifyKind(t: XTweet, ownerId: string): Kind {
  const ref = t.referenced_tweets?.[0];
  if (ref?.type === "retweeted") return "retweet";
  if (ref?.type === "replied_to") return t.in_reply_to_user_id === ownerId ? "selfReply" : "replyToOther";
  if (ref?.type === "quoted") return "quote";
  const urls = t.entities?.urls ?? [];
  const external = urls.filter((u) => !PHOTO_RE.test(u.expanded_url ?? "") && !u.media_key);
  if (t.attachments?.media_keys?.length || (urls.length && external.length === 0)) return "media";
  if (external.length) return "link";
  return "text";
}

function toItemUrls(t: XTweet): ItemUrl[] {
  return (t.entities?.urls ?? []).map((u) => {
    const expanded = u.unwound_url || u.expanded_url || u.url;
    const isMedia = PHOTO_RE.test(u.expanded_url ?? "") || !!u.media_key;
    return { url: u.url, expandedUrl: expanded, unwoundUrl: u.unwound_url, title: u.title, description: u.description, domain: domainOf(expanded), isMedia };
  });
}

export function parseTimeline(payload: XTimelinePayload, ownerId: string, researchQuestionPostId: string): Item[] {
  const mediaByKey = new Map((payload.includes?.media ?? []).map((m) => [m.media_key, m]));
  const now = new Date();
  const items = (payload.data ?? []).map<Item>((t) => {
    const kind = classifyKind(t, ownerId);
    const ref = t.referenced_tweets?.[0];
    const media: ItemMedia[] = (t.attachments?.media_keys ?? []).map((k) => {
      const m = mediaByKey.get(k);
      return { mediaKey: k, type: m?.type ?? "photo", url: m?.url, previewUrl: m?.preview_image_url, altText: m?.alt_text };
    });
    return {
      xId: t.id, text: t.note_tweet?.text ?? t.text, createdAt: new Date(t.created_at), kind, urls: toItemUrls(t), media,
      parentId: ref?.type === "replied_to" ? ref.id : undefined, quotedId: ref?.type === "quoted" ? ref.id : undefined,
      lang: t.lang, publicMetrics: t.public_metrics, isResearchQuestion: t.id === researchQuestionPostId, stage: "ingested", fetchedAt: now,
    };
  });
  return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
