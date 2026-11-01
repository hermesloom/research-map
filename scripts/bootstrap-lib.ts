import type { XTimelinePayload } from "@/lib/x/parse";
import { routeHost } from "@/lib/enrich/router";
import type { Item } from "@/lib/types";

/** The saved export has {tweets, includes}; the API payload has {data, includes}. */
export function toPayload(file: { tweets: unknown[]; includes?: { media?: unknown[]; [k: string]: unknown } }): XTimelinePayload {
  return { data: file.tweets as XTimelinePayload["data"], includes: { media: (file.includes?.media ?? []) as NonNullable<XTimelinePayload["includes"]>["media"] } };
}
/** Only generic-host first URLs of canvas-eligible posts reach Firecrawl. */
export function estimateFirecrawlCredits(items: Pick<Item, "kind" | "urls">[]): number {
  return items
    .filter((i) => !["replyToOther", "retweet", "media"].includes(i.kind))
    .map((i) => i.urls.find((u) => !u.isMedia)?.expandedUrl)
    .filter((u): u is string => !!u)
    .filter((u) => routeHost(u) === "generic").length;
}
