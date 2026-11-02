# LLM-friendly API

Date: 2026-11-02. Status: built and verified (unit, build, e2e, live run against production data; one independent code review applied) — built autonomously from the owner's one-line instruction ("the entire project should now also have a really LLM-friendly API"). The owner was not available for brainstorming questions, so every decision below marked *(call)* is the builder's and is open to revision. Companion to `2026-11-01-research-map-design.md`.

## 1. Intent

The map is built for human visitors. Language models and agents (Claude, ChatGPT, Cursor, custom scripts) should be able to use the same corpus without reverse-engineering the canvas: ask what the map is about, pull the posts under a theme, search semantically, read one post with its context, or load the whole thing into context as Markdown. "LLM-friendly" means, concretely:

1. **Self-describing.** One URL tells an agent everything: what the data is, which endpoints exist, their parameters, worked examples, and where the machine-readable spec lives. `GET /llms.txt` (the llms.txt convention), `GET /api/v1` (index) and `GET /api/v1/openapi.json`.
2. **Denormalised rows, readable names.** One post is one object with labels inlined (theme label, topic label, grade with a word, role, rationale, sub-question texts). Never parallel arrays or integer codes that need a lookup in another file.
3. **Two representations.** JSON by default; Markdown on `Accept: text/markdown` or `?format=md`. Markdown is for reading into context; JSON is for tool calls.
4. **Bounded, predictable.** Every list is paginated with `limit`/`offset` and reports `total` and `next`. Limits have documented maxima. Unknown query parameters are a 400 (a typo must never silently return the unfiltered corpus); an empty value counts as absent. Errors are JSON with a `code`, a sentence, and a `hint` that says how to fix the call.
5. **A native tool surface.** The same operations are exposed as an MCP server at `POST /api/mcp` (Streamable HTTP, stateless), so an agent host can call `search_posts` without writing HTTP glue.
6. **Free to run.** Reads come from the published snapshot on Vercel Blob, cached in memory per process for five minutes; if a refresh fails, the warm corpus keeps being served. No database is touched except for semantic search (one embedding call plus one Atlas vector query). Same cost model as the browser.

## 2. Goals, non-goals, anti-goals

Goals: everything in §1; the canvas keeps working unchanged; `pnpm typecheck`, `pnpm test`, `pnpm build` stay green; unit tests cover the pure core and each route's negotiation and error paths.

Non-goals *(call)*: writes of any kind (owner curation stays in the browser's owner mode); authentication or rate limiting (Hobby plan, public read-only data, the one paid call per search is an embedding at ~$0.00001); original post text (the snapshot carries the English title and summary; the X permalink is the source of record); per-user state.

Anti-goals: an API that returns the columnar snapshot as-is; endpoints that silently fall back (a semantic search that quietly became lexical would mislead); undocumented limits.

## 3. Shape of the data

```ts
Post {
  id: string;                       // X post id
  url: string;                      // https://x.com/sigalor/status/<id>
  createdAt: string;                // ISO 8601
  kind: "text"|"link"|"media"|"selfReply"|"quote";
  language: string;                 // "en" | "de" | "other" | "und"
  title: string;                    // English
  summary: string;                  // English, one or two sentences
  tags: string[];
  link: { url: string; domain: string } | null;
  thumbnail: string | null;
  theme: { id: number; label: string } | null;    // null = unclustered
  topic: { id: number; label: string } | null;    // leaf cluster
  relevance: { grade: 0|1|2|3|null; label: "core"|"adjacent"|"peripheral"|"unrelated"|"ungraded"; role: string; rationale: string };
  subQuestions: { id: string; text: string }[];
  position: { x: number; y: number; provisional: boolean };   // topic-terrain coordinates
  isResearchQuestion: boolean;
}
```

Grade words *(call)*: 3 core, 2 adjacent, 1 peripheral, 0 unrelated, missing ungraded. "Leaf cluster" is called **topic** in the API because that is what the label is.

Envelope for lists: `{ data: Post[], page: { limit, offset, total, next: string|null }, snapshot: { layoutVersion, generatedAt, count } }`. Single objects: `{ data: {...}, snapshot }`. Errors: `{ error: { code, message, hint, docs } }` with 400/404/500/503.

## 4. Endpoints (all GET, all public, CORS `*`)

| Path | Purpose |
| --- | --- |
| `/llms.txt` | Plain-text guide for agents: what this is, the question, the endpoints with one example each, MCP URL. |
| `/api/v1` | Index: the same guide as JSON (and Markdown): endpoints, parameters, enums, conventions, snapshot info. |
| `/api/v1/openapi.json` | OpenAPI 3.1 document generated from the zod query schemas. |
| `/api/v1/overview` | The map at a glance: research question, sub-questions with counts, themes → topics with sizes and mean grade, grade and kind distributions, date range. |
| `/api/v1/themes`, `/api/v1/themes/{id}` | Themes; one theme with its topics and its top posts. |
| `/api/v1/topics`, `/api/v1/topics/{id}` | Topics; one topic with its posts (paginated). |
| `/api/v1/questions`, `/api/v1/questions/{id}` | Core question and sub-question tree with counts; one question with its posts and their roles. |
| `/api/v1/posts` | Filterable list: `theme`, `topic`, `question`, `minGrade`, `role`, `kind`, `language`, `since`, `until`, `q` (lexical, title/summary/tags), `sort` (newest, oldest, relevance), `limit` (≤ 500, default 50), `offset`. |
| `/api/v1/posts/{id}` | One post plus `neighbors`: the k nearest posts on the topic terrain (`k` ≤ 50, default 10). |
| `/api/v1/search` | Semantic search: `q` (≤ 300 chars), `limit` ≤ 50, `minGrade`. Returns posts with `score`. 503 with a hint when embeddings or Atlas are not configured; never a silent lexical fallback. |
| `/api/v1/export` | The corpus (same filters as `/posts`; at most 2,500 posts per call, paged with `offset`, which keeps the body under Vercel's 4.5 MB response cap) as Markdown grouped theme → topic → posts, or JSON Lines, or JSON. |
| `/api/mcp` | MCP server. Tools: `get_overview`, `list_posts`, `get_post`, `search_posts`, `get_theme`, `get_topic`, `get_question`, `export_markdown`. Resources: `researchmap://overview`, `researchmap://llms.txt`. Tool results carry Markdown text plus `structuredContent`. |

Cache headers *(call)*: snapshot-derived routes `public, max-age=0, s-maxage=300, stale-while-revalidate=86400`; search `s-maxage=3600`; `llms.txt`, index and OpenAPI `s-maxage=3600`.

Existing routes (`/api/manifest`, `/api/posts`, `/api/search`, `/api/status`, owner, cron) are untouched; the canvas keeps using them.

## 5. Architecture

```
lib/api/corpus.ts    pure: columnar snapshot → Corpus { posts, byId, themes, topics, questions, ... }; filters, sort, pagination, k-nearest
lib/api/loader.ts    getCorpus(): manifest (Mongo, or public/dev when NEXT_PUBLIC_DEV_MANIFEST is set) → fetch points/meta/labels → buildCorpus; memoised per generatedAt, re-checked every 5 min
lib/api/markdown.ts  pure renderers: post, post list, overview, theme, topic, question, export
lib/api/http.ts      negotiate(format), ok()/fail(), base URL from the request, cache + CORS headers, zod query parsing → 400 with hints
lib/api/schemas.ts   zod schemas for every query/param (single source for routes, OpenAPI and MCP)
lib/api/ops.ts       the operations (overview, listPosts, getPost, getTheme, ...) over a Corpus; used by REST routes and MCP tools
lib/api/search.ts    semantic search → Post[] with scores (embedTexts + Atlas exact kNN)
lib/api/docs.ts      llms.txt text, index document, OpenAPI builder
lib/api/routes.ts    every /api/v1 handler (parse → op → respond); the route files under app/ are one-line mounts
lib/api/tools.ts     the MCP tool surface (name, description, zod input, run) over ops + markdown
lib/api/mcp.ts       registers tools and resources on an MCP server (mcp-handler)
app/llms.txt/route.ts, app/api/v1/**/route.ts, app/api/mcp/route.ts
```

Routes are thin: parse → op → respond. Everything with logic lives in `lib/api` and has Node unit tests. The dev fixture (`pnpm tsx scripts/fixture-snapshot.ts`, then `NEXT_PUBLIC_DEV_MANIFEST=/dev/manifest.json pnpm dev`) powers the e2e tests and local use without Mongo or Blob; unit tests build a tiny snapshot in-process.

## 6. Dependencies *(call)*

`mcp-handler@^2` and `@modelcontextprotocol/server@^2` (MCP SDK v2, 2026-07-28 spec, stateless over Streamable HTTP; mcp-handler is Vercel Labs, Apache-2.0). zod 4 already present; its `toJSONSchema` generates the OpenAPI parameter schemas.

## 7. Testing

Unit: `buildCorpus` on the fixture snapshot (counts, labels inlined, grade words, unclustered → null theme); filters (each parameter, combined, bad values → 400 with the hint); pagination `next`; k-nearest excludes self; Markdown renderers (golden fragments, escaping of `|` and newlines); OpenAPI document validates structurally (every route path present, every query param documented); llms.txt mentions every endpoint; route negotiation (`Accept`, `?format`), CORS and cache headers, 404 for unknown ids; search route 503 without configuration and happy path with a stubbed embedder and db; MCP: `initialize`, `tools/list` lists all eight tools, `tools/call get_overview` returns Markdown + structured content.

Playwright (existing dev-server setup): `/llms.txt` 200 text/plain; `/api/v1/posts?limit=2` returns two rows with labels.

## 8. Left to the builder

Exact Markdown layout; the wording of hints; the `next` URL construction; whether `export` streams (it does not need to at 1.2k posts).
