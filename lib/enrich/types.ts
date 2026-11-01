import type { EnrichSource } from "../types";
export interface Fetched { source: EnrichSource; title?: string; excerpt?: string; ogImage?: string; language?: string; thin: boolean; }
/** null = "not mine / not found, try the next rung" */
export type Adapter = (url: string, ctx: AdapterCtx) => Promise<Fetched | null>;
export interface AdapterCtx { fetchImpl: typeof fetch; firecrawlKey?: string; userAgent: string; }
export const USER_AGENT = "research.nalenz.org/1.0 (https://github.com/hermesloom/research-map; info@divizend.com)";
