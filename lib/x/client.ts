import { env } from "../env";
import { oauth1Header } from "./oauth1";
import type { XTimelinePayload } from "./parse";

const TWEET_FIELDS = "created_at,entities,attachments,referenced_tweets,in_reply_to_user_id,lang,public_metrics,note_tweet";
const MEDIA_FIELDS = "url,preview_image_url,type,alt_text";

export interface FetchOpts { sinceId?: string; startTime?: string; maxPages?: number; fetchImpl?: typeof fetch; }

/** One bounded timeline read. Never call without since_id or start_time: that would be a full (billed) sweep. */
export async function fetchNewPosts(opts: FetchOpts): Promise<{ payload: XTimelinePayload; requests: number }> {
  if (!opts.sinceId && !opts.startTime) throw new Error("fetchNewPosts requires since_id or start_time (billing guard)");
  const e = env(); const f = opts.fetchImpl ?? fetch; const maxPages = opts.maxPages ?? 5;
  const base = `https://api.x.com/2/users/${e.X_USER_ID}/tweets`;
  const merged: XTimelinePayload = { data: [], includes: { media: [] } };
  let token: string | undefined; let requests = 0;
  do {
    const q: Record<string, string> = { max_results: "100", "tweet.fields": TWEET_FIELDS, expansions: "attachments.media_keys", "media.fields": MEDIA_FIELDS };
    if (opts.sinceId) q.since_id = opts.sinceId;
    if (opts.startTime) q.start_time = opts.startTime;
    if (token) q.pagination_token = token;
    const url = `${base}?${new URLSearchParams(q)}`;
    const headers: Record<string, string> = {};
    if (e.X_ACCESS_TOKEN && e.X_ACCESS_TOKEN_SECRET && e.X_CONSUMER_KEY && e.X_CONSUMER_SECRET) {
      headers.Authorization = oauth1Header({ method: "GET", url: base, query: q, consumerKey: e.X_CONSUMER_KEY, consumerSecret: e.X_CONSUMER_SECRET, token: e.X_ACCESS_TOKEN, tokenSecret: e.X_ACCESS_TOKEN_SECRET });
    } else if (e.X_BEARER_TOKEN) headers.Authorization = `Bearer ${e.X_BEARER_TOKEN}`;
    else throw new Error("No X credentials configured");
    const res = await f(url, { headers }); requests++;
    if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = (await res.json()) as XTimelinePayload;
    merged.data!.push(...(page.data ?? []));
    merged.includes!.media!.push(...(page.includes?.media ?? []));
    if (!merged.meta && page.meta) merged.meta = { newest_id: page.meta.newest_id };
    token = page.meta?.next_token;
  } while (token && requests < maxPages);
  return { payload: merged, requests };
}
