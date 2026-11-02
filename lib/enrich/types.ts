import type { EnrichSource } from "../types";
export interface Fetched { source: EnrichSource; title?: string; excerpt?: string; ogImage?: string; language?: string; thin: boolean; }
/** null = "not mine / not found, try the next rung" */
export type Adapter = (url: string, ctx: AdapterCtx) => Promise<Fetched | null>;
/** `giveUp`: a transient Firecrawl failure no longer defers the post; the ladder moves on (OpenAlex, Wayback, thin record). Set after repeated deferrals. */
export interface AdapterCtx { fetchImpl: typeof fetch; firecrawlKey?: string; userAgent: string; giveUp?: boolean; }
export const USER_AGENT = "research.nalenz.org/1.0 (https://github.com/hermesloom/research-map; info@divizend.com)";
