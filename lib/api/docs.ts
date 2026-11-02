import { z } from "zod";
import type { Corpus } from "./corpus";
import { TOOLS } from "./tools";
import { FormatSchema, ListQuerySchema, PostsQuerySchema, PostDetailQuerySchema, SearchQuerySchema, ExportQuerySchema, PostSchema, PageInfoSchema, SnapshotInfoSchema, ErrorSchema } from "./schemas";

export interface Endpoint { path: string; summary: string; description: string; query?: z.ZodObject; pathParam?: { name: string; type: "string" | "integer"; description: string }; example: string; markdown: boolean; formats?: string[] }
export const ENDPOINTS: Endpoint[] = [
  { path: "/api/v1", summary: "This index", description: "Everything an agent needs to use the API: endpoints, parameters, enums, conventions, the current snapshot.", query: FormatSchema, example: "/api/v1", markdown: true },
  { path: "/api/v1/openapi.json", summary: "OpenAPI 3.1 document", description: "Machine-readable description of every endpoint and schema.", example: "/api/v1/openapi.json", markdown: false },
  { path: "/api/v1/overview", summary: "The map at a glance", description: "Research question, sub-questions with counts, themes → topics with sizes and mean grade, distributions, date range. Start here to learn ids.", query: FormatSchema, example: "/api/v1/overview?format=md", markdown: true },
  { path: "/api/v1/themes", summary: "All themes", description: "Top-level themes with their topics and sizes.", query: FormatSchema, example: "/api/v1/themes", markdown: true },
  { path: "/api/v1/themes/{id}", summary: "One theme", description: "A theme with its topics and its posts sorted by relevance (paginated).", query: ListQuerySchema, pathParam: { name: "id", type: "integer", description: "Theme id." }, example: "/api/v1/themes/0?limit=20", markdown: true },
  { path: "/api/v1/topics", summary: "All topics", description: "Leaf topics with parent theme, size and mean grade.", query: FormatSchema, example: "/api/v1/topics", markdown: true },
  { path: "/api/v1/topics/{id}", summary: "One topic", description: "A topic with its theme and its posts sorted by relevance (paginated).", query: ListQuerySchema, pathParam: { name: "id", type: "integer", description: "Topic id." }, example: "/api/v1/topics/3?format=md", markdown: true },
  { path: "/api/v1/questions", summary: "Question tree", description: "The core research question and the sub-questions, each with the number of posts graded against it.", query: FormatSchema, example: "/api/v1/questions", markdown: true },
  { path: "/api/v1/questions/{id}", summary: "One question", description: "A question with its children and the posts graded against it, each with role and rationale (paginated, most relevant first). To filter these posts further use /api/v1/posts?question={id}&minGrade=….", query: ListQuerySchema, pathParam: { name: "id", type: "string", description: "'core' or a sub-question id." }, example: "/api/v1/questions/core?limit=20&format=md", markdown: true },
  { path: "/api/v1/posts", summary: "List and filter posts", description: "Every post as one object with labels inlined. Filter by theme, topic, question, minGrade, role, kind, language, since/until, or a lexical substring q. Paginated; `page.next` is the next page's URL.", query: PostsQuerySchema, example: "/api/v1/posts?minGrade=2&since=2026-09-01&limit=100", markdown: true },
  { path: "/api/v1/posts/{id}", summary: "One post", description: "A post with its labels, relevance rationale, sub-questions and the k nearest posts on the topic terrain.", query: PostDetailQuerySchema, pathParam: { name: "id", type: "string", description: "X post id." }, example: "/api/v1/posts/2115703316281778260?neighbors=5", markdown: true },
  { path: "/api/v1/search", summary: "Semantic search", description: "Embed the query and rank every post by cosine similarity of its English summary. Returns posts with a score. 503 with a hint if the deployment has no embedding backend; never a silent lexical fallback.", query: SearchQuerySchema, example: "/api/v1/search?q=how%20do%20institutions%20become%20legible&limit=10", markdown: true },
  { path: "/api/v1/export", summary: "Export the corpus", description: "All posts (or a filtered subset, same filters as /posts) as Markdown grouped theme → topic → posts, JSON Lines, or a JSON array. At most 2500 posts per call; page with offset.", query: ExportQuerySchema, example: "/api/v1/export?minGrade=2&format=md", markdown: true, formats: ["md", "jsonl", "json"] },
];

const CONVENTIONS = [
  "All endpoints are GET, public, read-only, CORS-enabled (Access-Control-Allow-Origin: *).",
  "JSON by default. Add `?format=md` or send `Accept: text/markdown` for Markdown meant to be read into a model's context.",
  "Lists are paginated with `limit` and `offset`; responses carry `page.total` and `page.next` (a full URL or null).",
  "Unknown query parameters are rejected with 400 (so a typo never silently returns the unfiltered corpus). An empty value (`?theme=`) is treated as if the parameter were absent.",
  "Every response includes `snapshot` (layoutVersion, generatedAt, count). Data changes at most once a day (04:00 UTC); responses are CDN-cached for 5 minutes.",
  "Errors are JSON: `{ error: { code, message, hint, docs } }` with status 400 (bad parameter), 404 (unknown id), 503 (no snapshot / search unavailable).",
  "Relevance grades: 3 core, 2 adjacent, 1 peripheral, 0 unrelated; null means not graded yet. Posts below grade 1 are hidden by default in the UI but never in this API.",
  "A post has one identity (its X id) and appears in several places: a theme, a topic, zero or more sub-questions, and coordinates on the topic terrain. None of these is the one true organisation.",
  "Ids are stable within a layout version; theme and topic ids can change when the batch job re-lays out the map (rarely). Post ids never change.",
];

function params(e: Endpoint) {
  const out: { name: string; in: "path" | "query"; required: boolean; description: string; schema: Record<string, unknown> }[] = [];
  if (e.pathParam) out.push({ name: e.pathParam.name, in: "path", required: true, description: e.pathParam.description, schema: { type: e.pathParam.type } });
  if (e.query) { const js = z.toJSONSchema(e.query, { io: "input" }) as { properties?: Record<string, Record<string, unknown>>; required?: string[] }; for (const [name, s] of Object.entries(js.properties ?? {})) { const { description, ...schema } = s; out.push({ name, in: "query", required: (js.required ?? []).includes(name), description: String(description ?? ""), schema }); } }
  return out;
}

export function indexDoc(base: string, c: Corpus | null) {
  return {
    name: "research.nalenz.org API", version: "1", description: "A living map of every post on @sigalor, organised around one research question. This API gives language models and agents the same corpus the canvas shows: posts with inlined labels, themes, topics, the question tree, semantic search and a Markdown export.",
    researchQuestion: c?.researchQuestion.text ?? null, snapshot: c?.snapshot ?? null, llmsTxt: `${base}/llms.txt`, openapi: `${base}/api/v1/openapi.json`, canvas: base, source: "https://github.com/hermesloom/research-map",
    conventions: CONVENTIONS,
    endpoints: ENDPOINTS.map((e) => ({ method: "GET", path: e.path, summary: e.summary, description: e.description, formats: e.formats ?? (e.markdown ? ["json", "md"] : ["json"]), parameters: params(e).map(({ name, in: where, required, description, schema }) => ({ name, in: where, required, description, type: schema.type ?? "string", enum: schema.enum, default: schema.default, minimum: schema.minimum, maximum: schema.maximum })), example: `${base}${e.example}` })),
    mcp: { url: `${base}/api/mcp`, transport: "streamable-http", tools: TOOLS.map((t) => ({ name: t.name, description: t.description })), note: "Stateless MCP server (spec 2026-07-28 with 2025-era fallback). Add the URL to any MCP client; no auth." },
    recipes: [
      { goal: "Understand the map", steps: [`GET ${base}/api/v1/overview?format=md`] },
      { goal: "Read everything core to the question", steps: [`GET ${base}/api/v1/export?minGrade=3&format=md`] },
      { goal: "Find posts about a concept", steps: [`GET ${base}/api/v1/search?q=<concept>&limit=10&format=md`, `then GET ${base}/api/v1/posts/<id>?format=md for context and neighbours`] },
      { goal: "What is new since a date", steps: [`GET ${base}/api/v1/posts?since=<ISO date>&sort=newest&format=md`] },
      { goal: "Posts behind one sub-question", steps: [`GET ${base}/api/v1/questions`, `GET ${base}/api/v1/questions/<id>?format=md`] },
    ],
  };
}
export function mdIndex(base: string, c: Corpus | null): string {
  const d = indexDoc(base, c); const out = [`# ${d.name}`, "", d.description, ""];
  if (d.researchQuestion) out.push(`> ${d.researchQuestion}`, "");
  if (d.snapshot) out.push(`_Snapshot: layout v${d.snapshot.layoutVersion}, generated ${d.snapshot.generatedAt}, ${d.snapshot.count} posts._`, "");
  out.push("## Conventions", "", ...d.conventions.map((x) => `- ${x}`), "", "## Endpoints", "");
  for (const e of d.endpoints) { out.push(`### GET ${e.path}`, "", e.description, "", `Example: ${e.example}`); if (e.parameters.length) { out.push("", "Parameters:"); for (const p of e.parameters) out.push(`- \`${p.name}\`${p.required ? " (required)" : ""}${p.enum ? ` — one of ${(p.enum as string[]).join(", ")}` : ""}${p.default !== undefined ? ` — default ${JSON.stringify(p.default)}` : ""}: ${p.description}`); } out.push(""); }
  out.push("## MCP", "", `Streamable HTTP endpoint: ${d.mcp.url} (no auth). Tools:`, "", ...d.mcp.tools.map((t) => `- \`${t.name}\`: ${t.description}`), "", "## Recipes", "", ...d.recipes.map((r) => `- **${r.goal}**: ${r.steps.join(" → ")}`), "", `OpenAPI: ${d.openapi} · Source: ${d.source}`);
  return out.join("\n") + "\n";
}
export function llmsTxt(base: string, c: Corpus | null): string {
  const out = ["# research.nalenz.org", "", "> A living map of every post on @sigalor (X), organised automatically around one research question. Each post has an English title and summary, a theme, a topic, a relevance grade (0–3) with a rationale, and links to the sub-questions it speaks to."];
  if (c) out.push("", `The research question: ${c.researchQuestion.text}`, "", `Snapshot: ${c.snapshot.count} posts, layout v${c.snapshot.layoutVersion}, generated ${c.snapshot.generatedAt}. Updated daily.`);
  out.push("", "All API endpoints are GET, public, read-only and return JSON; add ?format=md for Markdown.", "", "## API", "");
  for (const e of ENDPOINTS) out.push(`- [${e.summary}](${base}${e.path}): ${e.description.split(". ")[0]}. Example: ${base}${e.example}`);
  out.push("", "## MCP", "", `- [MCP server](${base}/api/mcp): Streamable HTTP, no auth. Tools: ${TOOLS.map((t) => t.name).join(", ")}.`, "", "## Optional", "", `- [OpenAPI](${base}/api/v1/openapi.json): full machine-readable spec.`, `- [Source code](https://github.com/hermesloom/research-map): MIT. Post content belongs to the author.`, `- [The canvas](${base}): the human-facing map.`);
  return out.join("\n") + "\n";
}

export function openapi(base: string) {
  const schema = (s: z.ZodType) => { const js = { ...(z.toJSONSchema(s, { io: "output" }) as Record<string, unknown>) }; delete js.$schema; delete js.additionalProperties; return js; };   // components are extended with allOf (score, distance, neighbors), so they must stay open
  const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
  const paged = (item: Record<string, unknown>) => ({ type: "object", required: ["data", "page", "snapshot"], properties: { data: { type: "array", items: item }, page: ref("PageInfo"), snapshot: ref("SnapshotInfo") } });
  const single = (item: Record<string, unknown>) => ({ type: "object", required: ["data", "snapshot"], properties: { data: item, snapshot: ref("SnapshotInfo") } });
  const err = (d: string) => ({ description: d, content: { "application/json": { schema: ref("Error") } } });
  const ok = (json: Record<string, unknown>, md: boolean, jsonl = false) => ({ description: "OK", content: { "application/json": { schema: json }, ...(md ? { "text/markdown": { schema: { type: "string" } } } : {}), ...(jsonl ? { "application/jsonl": { schema: { type: "string", description: "One Post JSON object per line." } } } : {}) } });
  const withPosts = (entity: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "object", required: ["data", "page", "snapshot"], properties: { data: { allOf: [entity, { type: "object", required: ["posts"], properties: { ...extra, posts: { type: "array", items: ref("Post") } } }] }, page: ref("PageInfo"), snapshot: ref("SnapshotInfo") } });
  const bodies: Record<string, Record<string, unknown>> = {
    "/api/v1": { type: "object", description: "Index document (see GET /api/v1)." }, "/api/v1/openapi.json": { type: "object" }, "/api/v1/overview": { type: "object", description: "Overview (research question, counts, distributions, themes with topics, questions)." },
    "/api/v1/themes": single({ type: "array", items: ref("Theme") }), "/api/v1/themes/{id}": withPosts(ref("Theme")), "/api/v1/topics": single({ type: "array", items: ref("Topic") }), "/api/v1/topics/{id}": withPosts(ref("Topic"), { theme: { oneOf: [ref("Theme"), { type: "null" }] } }),
    "/api/v1/questions": single({ type: "array", items: ref("Question") }), "/api/v1/questions/{id}": withPosts(ref("Question"), { children: { type: "array", items: ref("Question") } }), "/api/v1/posts": paged(ref("Post")),
    "/api/v1/posts/{id}": single({ allOf: [ref("Post"), { type: "object", properties: { neighbors: { type: "array", items: { allOf: [ref("Post"), { type: "object", properties: { distance: { type: "number" } } }] } } } }] }),
    "/api/v1/search": { type: "object", required: ["query", "data", "snapshot"], properties: { query: { type: "string" }, data: { type: "array", items: { allOf: [ref("Post"), { type: "object", properties: { score: { type: "number" } } }] } }, snapshot: ref("SnapshotInfo") } },
    "/api/v1/export": { type: "array", items: ref("Post") },
  };
  const paths: Record<string, unknown> = {};
  for (const e of ENDPOINTS) {
    const responses: Record<string, unknown> = { 200: ok(bodies[e.path], e.markdown, e.path === "/api/v1/export"), 400: err("Invalid or unknown parameter; the hint names it."), 503: err("No snapshot published yet, or search unavailable.") };
    if (e.pathParam) responses[404] = err("Unknown id.");
    paths[e.path] = { get: { operationId: e.path.replace(/^\/api\/v1\/?/, "").replace(/\{id\}/g, "ById").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "index", summary: e.summary, description: e.description, parameters: params(e), responses } };
  }
  return {
    openapi: "3.1.0", info: { title: "research.nalenz.org API", version: "1.0.0", description: "Read-only API over a living map of @sigalor's research posts. JSON or Markdown (Accept: text/markdown or ?format=md). See /llms.txt and /api/v1 for a guided tour; MCP server at /api/mcp.", license: { name: "MIT", url: "https://github.com/hermesloom/research-map/blob/main/LICENSE" } },
    servers: [{ url: base }], paths,
    components: { schemas: { Post: schema(PostSchema), PageInfo: schema(PageInfoSchema), SnapshotInfo: schema(SnapshotInfoSchema), Error: schema(ErrorSchema),
      Theme: { type: "object", required: ["id", "label", "size", "topics"], properties: { id: { type: "integer" }, label: { type: "string" }, size: { type: "integer" }, topics: { type: "array", items: ref("Topic") } } },
      Topic: { type: "object", required: ["id", "label", "themeId", "size"], properties: { id: { type: "integer" }, label: { type: "string" }, themeId: { type: "integer" }, size: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, meanGrade: { type: ["number", "null"] } } },
      Question: { type: "object", required: ["id", "text", "parentId", "count"], properties: { id: { type: "string" }, text: { type: "string" }, parentId: { type: ["string", "null"] }, count: { type: "integer" } } } } },
  };
}
