import { z } from "zod";
import type { Corpus } from "./corpus";
import { overview, listPosts, getPost, getTheme, getTopic, getQuestion, exportPosts } from "./ops";
import { mdOverview, mdPage, mdPostDetail, mdTheme, mdTopic, mdQuestion, mdSearch, mdExport } from "./markdown";
import { PostFilterSchema, PageSchema, PostDetailQuerySchema, SearchQuerySchema, ExportQuerySchema, IdParamSchema } from "./schemas";
import { semanticSearch, type SearchDeps } from "./search";
import { ApiError } from "./http";

/** The MCP tool surface. Each tool returns Markdown for the model and a JSON object for programs; the REST routes expose the same operations. */
export interface ToolResult { markdown: string; structured: Record<string, unknown> }
export interface Tool<S extends z.ZodObject = z.ZodObject> { name: string; title: string; description: string; input: S; run: (c: Corpus, args: z.infer<S>, deps: { search: SearchDeps }) => Promise<ToolResult> }
const strip = <T extends z.ZodObject>(s: T) => s.omit({ format: true } as never) as unknown as T;
const page = (p: { page: { limit: number; offset: number; total: number; nextOffset: number | null } }) => ({ limit: p.page.limit, offset: p.page.offset, total: p.page.total, nextOffset: p.page.nextOffset });
const notFound = (what: string, id: string | number) => new ApiError(404, "not_found", `No ${what} with id ${JSON.stringify(id)}.`, `Call get_overview to list valid ${what} ids.`);
const def = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

export const TOOLS: Tool[] = [
  def({ name: "get_overview", title: "Map overview", description: "What the map is about: the research question, sub-questions with post counts, every theme and topic with sizes and mean relevance grade, and distributions of grade, kind, language and role. Call this first to learn the ids used by the other tools.", input: z.object({}),
    run: async (c) => { const o = overview(c); return { markdown: mdOverview(o, c), structured: o as unknown as Record<string, unknown> }; } }),
  def({ name: "list_posts", title: "List posts", description: "Filter and page through posts by theme, topic, question, minimum relevance grade, role, kind, language, date window or a lexical substring (q). Sorted newest first unless sort is set. Returns at most 500 per call; use offset to continue.", input: PostFilterSchema.extend(PageSchema.shape),
    run: async (c, a) => { const r = listPosts(c, a, a); return { markdown: mdPage("Posts", r, c, r.page.nextOffset !== null ? `offset=${r.page.nextOffset}` : null), structured: { data: r.data, page: page(r), snapshot: c.snapshot } }; } }),
  def({ name: "get_post", title: "Get one post", description: "One post by X id with its labels, relevance rationale, sub-questions and the nearest posts on the topic terrain.", input: IdParamSchema.extend(strip(PostDetailQuerySchema).shape),
    run: async (c, a) => { const r = getPost(c, a.id, a.neighbors); if (!r) throw notFound("post", a.id); return { markdown: mdPostDetail(r.post, r.neighbors, c), structured: { data: { ...r.post, neighbors: r.neighbors }, snapshot: c.snapshot } }; } }),
  def({ name: "search_posts", title: "Semantic search", description: "Meaning-based search: the query is embedded and matched against every post's English summary (cosine similarity). Best for questions and concepts; for exact words use list_posts with q.", input: strip(SearchQuerySchema),
    run: async (c, a, d) => { const rows = await semanticSearch(c, a.q, a.limit, a.minGrade, d.search); return { markdown: mdSearch(a.q, rows, c), structured: { query: a.q, data: rows, snapshot: c.snapshot } }; } }),
  def({ name: "get_theme", title: "Get a theme", description: "One top-level theme with its topics and its posts sorted by relevance.", input: z.object({ id: z.number().int().describe("Theme id from get_overview.") }).extend(PageSchema.shape),
    run: async (c, a) => { const r = getTheme(c, a.id, a); if (!r) throw notFound("theme", a.id); return { markdown: mdTheme(r.theme, r.posts, c, null), structured: { data: { ...r.theme, posts: r.posts.data }, page: page(r.posts), snapshot: c.snapshot } }; } }),
  def({ name: "get_topic", title: "Get a topic", description: "One leaf topic with its parent theme and its posts sorted by relevance.", input: z.object({ id: z.number().int().describe("Topic id from get_overview; -1 is not a topic (use list_posts with topic=-1 for unclustered posts).") }).extend(PageSchema.shape),
    run: async (c, a) => { const r = getTopic(c, a.id, a); if (!r) throw notFound("topic", a.id); return { markdown: mdTopic(r.topic, r.theme, r.posts, c, null), structured: { data: { ...r.topic, theme: r.theme, posts: r.posts.data }, page: page(r.posts), snapshot: c.snapshot } }; } }),
  def({ name: "get_question", title: "Get a question", description: "The core research question ('core') or one sub-question, with its child questions and the posts graded against it, including each post's role and rationale.", input: z.object({ id: z.string().describe("'core' or a sub-question id from get_overview.") }).extend(PageSchema.shape),
    run: async (c, a) => { const r = getQuestion(c, a.id, a); if (!r) throw notFound("question", a.id); return { markdown: mdQuestion(r.question, r.children, r.posts, c, null), structured: { data: { ...r.question, children: r.children, posts: r.posts.data }, page: page(r.posts), snapshot: c.snapshot } }; } }),
  def({ name: "export_markdown", title: "Export as Markdown", description: "A filtered subset of the corpus (or all of it, paged) as one Markdown document grouped theme → topic → posts, for loading into context. Same filters as list_posts. Default 300 posts per call (about 400 KB); use offset to continue, or narrow with minGrade/theme/topic.", input: strip(ExportQuerySchema).extend({ limit: z.coerce.number().int().min(1).max(1000).default(300).describe("Posts per call, 1–1000 (default 300).") }),
    run: async (c, a) => { const rows = exportPosts(c, a, a.limit, a.offset); const total = exportPosts(c, a, Number.MAX_SAFE_INTEGER).length; return { markdown: mdExport(rows, c) + (a.offset + rows.length < total ? `\n_${total - a.offset - rows.length} more posts match; continue with offset=${a.offset + rows.length}._\n` : ""), structured: { count: rows.length, total, nextOffset: a.offset + rows.length < total ? a.offset + rows.length : null, snapshot: c.snapshot } }; } }),
];
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
