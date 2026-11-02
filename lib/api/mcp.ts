import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";
import { getCorpus } from "./loader";
import { TOOLS } from "./tools";
import { overview } from "./ops";
import { mdOverview } from "./markdown";
import { llmsTxt } from "./docs";
import { defaultSearchDeps, type SearchDeps } from "./search";
import { ApiError } from "./http";
import type { Corpus } from "./corpus";

export const SERVER_INFO = { name: "research-map", version: "1.0.0" };
export const INSTRUCTIONS = "Read-only access to research.nalenz.org: a map of every post on @sigalor organised around one research question. Start with get_overview to learn theme, topic and question ids; use search_posts for meaning-based lookup, list_posts for filters, get_post for one post with its neighbours, and export_markdown to load the corpus into context. Every result carries Markdown text (for reading) and structuredContent (for programs).";

/** Register the shared tool surface and two resources on an MCP server. `deps` lets tests swap the corpus and search backend. */
/** Public origin for links inside MCP results: explicit SITE_URL, else Vercel's production or deployment host, else the production domain. */
export const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://research.nalenz.org");
export function registerAll(server: McpServer, deps: { corpus: () => Promise<Corpus>; search: SearchDeps; base: string } = { corpus: () => getCorpus(), search: defaultSearchDeps(), base: siteUrl() }) {
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } }, async (args: unknown) => {
      try { const c = await deps.corpus(); const r = await t.run(c, t.input.parse(args ?? {}), { search: deps.search }); return { content: [{ type: "text" as const, text: r.markdown }], structuredContent: r.structured }; }
      catch (e) { const msg = e instanceof ApiError ? `${e.message} ${e.hint}` : e instanceof Error && e.name === "NoSnapshotError" ? "No published snapshot yet; try again later." : "Unexpected error."; if (!(e instanceof ApiError) && !(e instanceof Error && e.name === "NoSnapshotError")) console.error(e); return { content: [{ type: "text" as const, text: msg }], isError: true }; }
    });
  }
  server.registerResource("overview", "researchmap://overview", { title: "Map overview (Markdown)", description: "Research question, themes, topics, sub-questions and counts.", mimeType: "text/markdown" }, async (uri) => { const c = await deps.corpus(); return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: mdOverview(overview(c), c) }] }; });
  server.registerResource("llms-txt", "researchmap://llms.txt", { title: "llms.txt", description: "Plain-text guide to the REST API.", mimeType: "text/plain" }, async (uri) => { const c = await deps.corpus().catch(() => null); return { contents: [{ uri: uri.href, mimeType: "text/plain", text: llmsTxt(deps.base, c) }] }; });
}
export const createHandler = (deps?: Parameters<typeof registerAll>[1]) => createMcpHandler((server) => registerAll(server, deps), { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
