import type { Enrichment, Item, Normalized } from "../types";
import { NormalizedSchema } from "../types";
import { parseStructured } from "./openai";

const URL_RE = /https?:\/\/\S+/g;
export const NORMALIZE_SYSTEM = `You normalize one social-media post by a researcher into structured metadata for a topic map. Posts may be English or German; bare links come with fetched page text; screenshots come with an OCR transcript.
Return: title (≤12 words, in English, specific), summaryEn (ONE sentence in English saying what the post is about and why someone would care — this is what gets embedded, so be concrete and avoid boilerplate like "Wikipedia article"), gist (1–2 sentences in the post's own language), tagsEn (3–8 lowercase English tags, canonical nouns), language, entities (named things: people, systems, standards, works), contentKind.`;

export function buildNormalizeInput(item: Item, enrich: Partial<Enrichment>, parent?: Item | null): { text: string; empty: boolean } {
  const own = item.text.replace(URL_RE, "").trim();
  const parts: string[] = [];
  if (parent) parts.push(`Parent post (same author):\n${parent.text.replace(URL_RE, "").trim()}`);
  if (own) parts.push(`Post text:\n${own}`);
  const urls = item.urls.filter((u) => !u.isMedia);
  if (urls.length) parts.push(`Links:\n${urls.map((u) => `- ${u.expandedUrl}${u.title ? ` [${u.title}]` : ""}`).join("\n")}`);
  if (enrich.title || enrich.excerpt) parts.push(`Fetched page:\nTitle: ${enrich.title ?? ""}\n${(enrich.excerpt ?? "").slice(0, 1500)}`);
  if (enrich.transcript || enrich.imageDescription) parts.push(`Image:\n${enrich.imageDescription ?? ""}\nTranscript:\n${(enrich.transcript ?? "").slice(0, 2500)}`);
  const substantive = !!(own || enrich.title || enrich.excerpt || enrich.transcript || enrich.imageDescription || urls.some((u) => u.title));
  return { text: parts.join("\n\n"), empty: !substantive };
}

/** null ⇔ nothing to normalize (empty-input guard): no model call is made. */
export async function normalizeItem(item: Item, enrich: Partial<Enrichment>, parent: Item | null, deps = { parse: parseStructured }): Promise<Normalized | null> {
  const { text, empty } = buildNormalizeInput(item, enrich, parent); if (empty) return null;
  return deps.parse(NormalizedSchema, "normalized", [{ role: "system", content: NORMALIZE_SYSTEM }, { role: "user", content: text }]);
}
