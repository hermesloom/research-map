import { z } from "zod";

/** Single source of truth for query parameters: routes parse with these, OpenAPI and MCP describe them. */
export const GRADE_WORDS = ["unrelated", "peripheral", "adjacent", "core"] as const;
export const ROLES = ["evidence", "example", "counterexample", "tool", "inspiration", "extension", "tangent", "unrelated"] as const;
export const KINDS = ["text", "link", "media", "selfReply", "quote"] as const;
export const SORTS = ["newest", "oldest", "relevance"] as const;
export const FORMATS = ["json", "md"] as const;
export const EXPORT_FORMATS = ["md", "jsonl", "json"] as const;

const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "must be an ISO 8601 date, e.g. 2026-09-01 or 2026-09-01T00:00:00Z" });

export const PostFilterSchema = z.object({
  theme: intParam(0, 10_000).optional().describe("Theme id (see /api/v1/themes)."),
  topic: intParam(-1, 100_000).optional().describe("Topic id (see /api/v1/topics); -1 selects unclustered posts."),
  question: z.string().min(1).max(64).optional().describe("Question id (core or a sub-question id from /api/v1/questions)."),
  minGrade: intParam(0, 3).optional().describe("Minimum relevance grade: 3 core, 2 adjacent, 1 peripheral, 0 unrelated. Ungraded posts are excluded when set."),
  role: z.enum(ROLES).optional().describe("Role the post plays for the research question."),
  kind: z.enum(KINDS).optional().describe("Kind of post."),
  language: z.string().min(2).max(5).optional().describe("Language of the original post: en, de, other."),
  since: isoDate.optional().describe("Only posts created at or after this date."),
  until: isoDate.optional().describe("Only posts created before this date."),
  q: z.string().trim().min(1).max(200).optional().describe("Lexical filter: case-insensitive substring match on title, summary and tags. For meaning-based search use /api/v1/search."),
  sort: z.enum(SORTS).default("newest").describe("newest (default), oldest, or relevance (grade desc, then newest)."),
});
export type PostFilter = z.infer<typeof PostFilterSchema>;

export const PageSchema = z.object({
  limit: intParam(1, 500).default(50).describe("Page size, 1–500 (default 50)."),
  offset: intParam(0, 1_000_000).default(0).describe("Rows to skip (default 0)."),
});
export type Page = z.infer<typeof PageSchema>;

export const FormatSchema = z.object({ format: z.enum(FORMATS).optional().describe("json (default) or md. Equivalent to Accept: text/markdown.") });

export const PostsQuerySchema = PostFilterSchema.extend(PageSchema.shape).extend(FormatSchema.shape);
export const ListQuerySchema = PageSchema.extend(FormatSchema.shape);
export const PostDetailQuerySchema = z.object({ neighbors: intParam(0, 50).default(10).describe("How many nearest posts on the topic terrain to include (0–50, default 10).") }).extend(FormatSchema.shape);
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(300).describe("Natural-language query (≤ 300 chars). Embedded and matched against every post's summary."),
  limit: intParam(1, 50).default(10).describe("Results, 1–50 (default 10)."),
  minGrade: intParam(0, 3).optional().describe("Drop results below this relevance grade."),
}).extend(FormatSchema.shape);
export const EXPORT_CAP = 2500;   // ~1.2 KB per post as JSON keeps the body under Vercel's 4.5 MB response limit
export const ExportQuerySchema = PostFilterSchema.extend({
  format: z.enum(EXPORT_FORMATS).default("md").describe("md (default): Markdown grouped theme → topic → posts; jsonl: one post per line; json: array."),
  limit: intParam(1, EXPORT_CAP).default(EXPORT_CAP).describe(`Maximum posts in the export (default and cap ${EXPORT_CAP}). For a larger corpus, page with offset or narrow with filters.`),
  offset: intParam(0, 1_000_000).default(0).describe("Posts to skip before exporting (for paging a corpus larger than the cap)."),
});
export const IdParamSchema = z.object({ id: z.string().min(1).max(64) });
export const IntIdParamSchema = z.object({ id: z.coerce.number().int() });

/** Wire shape of one post (also the MCP output schema and the OpenAPI component). Kept in sync with `Post` in corpus.ts by a type test. */
const RefSchema = z.object({ id: z.number().int(), label: z.string() });
export const PostSchema = z.object({
  id: z.string().describe("X post id."), url: z.string().describe("Permalink to the original post on X."), createdAt: z.string().describe("ISO 8601."),
  kind: z.string().describe("text | link | media | selfReply | quote"), language: z.string().describe("Language of the original: en, de, other, und."),
  title: z.string().describe("English title (LLM-normalised)."), summary: z.string().describe("One- or two-sentence English summary; this is what the embedding is built from."), tags: z.array(z.string()),
  link: z.object({ url: z.string(), domain: z.string() }).nullable().describe("First non-media link in the post, if any."), thumbnail: z.string().nullable(),
  theme: RefSchema.nullable().describe("Top-level theme; null when unclustered."), topic: RefSchema.nullable().describe("Leaf topic; null when unclustered."),
  relevance: z.object({ grade: z.number().int().min(0).max(3).nullable(), label: z.enum([...GRADE_WORDS, "ungraded"]), role: z.string(), rationale: z.string() }).describe("Relevance to the research question: 3 core, 2 adjacent, 1 peripheral, 0 unrelated, null ungraded."),
  subQuestions: z.array(z.object({ id: z.string(), text: z.string() })),
  position: z.object({ x: z.number(), y: z.number(), provisional: z.boolean() }).describe("Topic-terrain coordinates; provisional = placed by nearest neighbour since the last full layout."),
  isResearchQuestion: z.boolean(),
});
export const PageInfoSchema = z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int(), next: z.string().nullable().describe("URL of the next page, or null.") });
export const SnapshotInfoSchema = z.object({ layoutVersion: z.number().int(), generatedAt: z.string(), count: z.number().int(), embeddingModel: z.string() });
export const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), hint: z.string(), docs: z.string() }) });
