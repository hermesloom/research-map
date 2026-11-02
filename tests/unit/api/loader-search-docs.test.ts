import { describe, it, expect, beforeEach } from "vitest";
import { makeSnapshot, makeCorpus } from "./fixture";
import { getCorpus, resetCorpusCache, NoSnapshotError } from "@/lib/api/loader";
import { semanticSearch, searchUnavailable } from "@/lib/api/search";
import { TOOLS, toolByName } from "@/lib/api/tools";
import { ENDPOINTS, indexDoc, mdIndex, llmsTxt, openapi } from "@/lib/api/docs";
import { ApiError } from "@/lib/api/http";

const snap = makeSnapshot();
function deps(over: Partial<Parameters<typeof getCorpus>[0]> = {}) {
  const calls = { manifest: 0, files: 0 }; let t = 1_000_000; const files: Record<string, unknown> = { "/p": snap.points, "/m": snap.meta, "/l": snap.labels };
  return { calls, tick: (ms: number) => { t += ms; }, d: { fetchManifest: async () => { calls.manifest++; return snap.manifest; }, fetchJson: async (u: string) => { calls.files++; return files[u]; }, now: () => t, ttlMs: 1000, researchQuestionPostId: "1000", ...over } };
}
describe("getCorpus", () => {
  beforeEach(resetCorpusCache);
  it("builds once, serves from memory inside the TTL, re-checks the manifest after and rebuilds only on a new generatedAt", async () => {
    const x = deps(); const a = await getCorpus(x.d); expect(a.posts).toHaveLength(7); expect(x.calls).toEqual({ manifest: 1, files: 3 });
    expect(await getCorpus(x.d)).toBe(a); expect(x.calls.manifest).toBe(1);
    x.tick(1500); expect(await getCorpus(x.d)).toBe(a); expect(x.calls).toEqual({ manifest: 2, files: 3 });
    x.tick(1500); x.d.fetchManifest = async () => ({ ...snap.manifest, generatedAt: new Date("2026-11-03T04:00:00Z") }); const b = await getCorpus(x.d); expect(b).not.toBe(a); expect(x.calls.files).toBe(6); expect(b.snapshot.generatedAt).toBe("2026-11-03T04:00:00.000Z");
  });
  it("coalesces concurrent cold loads", async () => { const x = deps(); const [a, b] = await Promise.all([getCorpus(x.d), getCorpus(x.d)]); expect(a).toBe(b); expect(x.calls.files).toBe(3); });
  it("serves the warm corpus when a refresh fails, and backs off for one TTL", async () => {
    const x = deps(); const a = await getCorpus(x.d); x.tick(1500); x.d.fetchManifest = async () => { x.calls.manifest++; throw new Error("atlas blip"); };
    const orig = console.error; console.error = () => {}; try { expect(await getCorpus(x.d)).toBe(a); expect(x.calls.manifest).toBe(2); expect(await getCorpus(x.d)).toBe(a); expect(x.calls.manifest).toBe(2); x.tick(1500); expect(await getCorpus(x.d)).toBe(a); expect(x.calls.manifest).toBe(3); } finally { console.error = orig; }
  });
  it("throws NoSnapshotError without a manifest and does not poison the cache", async () => {
    const x = deps({ fetchManifest: async () => null }); await expect(getCorpus(x.d)).rejects.toBeInstanceOf(NoSnapshotError); const y = deps(); expect((await getCorpus(y.d)).posts).toHaveLength(7);
  });
});
describe("semanticSearch", () => {
  const c = makeCorpus();
  it("503s when not configured", async () => { await expect(semanticSearch(c, "x", 5, undefined, { configured: () => false, embed: async () => [[]], knn: async () => [] })).rejects.toMatchObject({ status: 503, code: "search_unavailable" }); expect(searchUnavailable()).toBeInstanceOf(ApiError); });
  it("joins knn rows to posts, drops the research question post and unknown ids, honours minGrade and limit", async () => {
    const rows = await semanticSearch(c, "q", 2, 2, { configured: () => true, embed: async (t) => { expect(t).toEqual(["q"]); return [[1, 0]]; }, knn: async (_v, limit) => { expect(limit).toBe(21); return [{ xId: "1000", score: 0.9 }, { xId: "nope", score: 0.8 }, { xId: "1003", score: 0.7 }, { xId: "1001", score: 0.65432 }, { xId: "1002", score: 0.6 }, { xId: "1005", score: 0.5 }]; } });
    expect(rows.map((r) => [r.id, r.score])).toEqual([["1001", 0.6543], ["1002", 0.6]]);
  });
});
describe("tools", () => {
  const c = makeCorpus(); const d = { search: { configured: () => true, embed: async () => [[1]], knn: async () => [{ xId: "1001", score: 0.8 }] } };
  it("exposes eight tools with unique names and object input schemas", () => { expect(TOOLS.map((t) => t.name)).toEqual(["get_overview", "list_posts", "get_post", "search_posts", "get_theme", "get_topic", "get_question", "export_markdown"]); for (const t of TOOLS) expect(t.input.safeParse({ ...(t.name === "get_post" ? { id: "1000" } : {}), ...(t.name === "search_posts" ? { q: "x" } : {}), ...(t.name === "get_question" ? { id: "core" } : {}), ...(["get_theme", "get_topic"].includes(t.name) ? { id: 0 } : {}) }).success).toBe(true); });
  it("runs each tool to Markdown plus structured content", async () => {
    const run = (n: string, a: Record<string, unknown>) => toolByName(n)!.run(c, toolByName(n)!.input.parse(a), d);
    expect((await run("get_overview", {})).markdown).toContain("## Themes and topics");
    const lp = await run("list_posts", { minGrade: 3, limit: 1 }); expect(lp.structured.page).toMatchObject({ total: 2, nextOffset: 1 }); expect(lp.markdown).toContain("Next page: offset=1");
    expect(((await run("get_post", { id: "1001", neighbors: 2 })).structured.data as { neighbors: unknown[] }).neighbors).toHaveLength(2);
    expect((await run("search_posts", { q: "ontologies" })).markdown).toContain("score 0.800");
    expect((await run("get_theme", { id: 1 })).markdown).toContain("# Theme 1: Changing structures"); expect((await run("get_topic", { id: 1 })).markdown).toContain("Theme: Making structures explicit");
    expect((await run("get_question", { id: "seed-1" })).structured.page).toMatchObject({ total: 3 }); const ex = await run("export_markdown", { theme: 0, limit: 2 }); expect(ex.structured).toMatchObject({ count: 2, total: 5, nextOffset: 2 }); expect(ex.markdown).toContain("continue with offset=2"); expect((await run("export_markdown", { theme: 0, offset: 4 })).structured.nextOffset).toBeNull();
  });
  it("unknown ids raise a 404 ApiError", async () => { await expect(toolByName("get_theme")!.run(c, { id: 42, limit: 50, offset: 0 }, d)).rejects.toMatchObject({ status: 404 }); });
});
describe("docs", () => {
  const c = makeCorpus(); const base = "https://research.nalenz.org";
  it("index lists every endpoint with parameters, the MCP tools and recipes", () => {
    const d = indexDoc(base, c); expect(d.endpoints.map((e) => e.path)).toEqual(ENDPOINTS.map((e) => e.path)); expect(d.mcp.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    const posts = d.endpoints.find((e) => e.path === "/api/v1/posts")!; expect(posts.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["theme", "topic", "question", "minGrade", "role", "kind", "language", "since", "until", "q", "sort", "limit", "offset", "format"]));
    expect(posts.parameters.find((p) => p.name === "sort")).toMatchObject({ enum: ["newest", "oldest", "relevance"], default: "newest" }); expect(posts.parameters.find((p) => p.name === "limit")).toMatchObject({ maximum: 500, default: 50 });
    expect(d.endpoints.find((e) => e.path === "/api/v1/posts/{id}")!.parameters[0]).toMatchObject({ name: "id", in: "path", required: true }); expect(d.researchQuestion).toBe(c.researchQuestion.text); expect(d.recipes.length).toBeGreaterThan(3);
    expect(indexDoc(base, null).snapshot).toBeNull();
  });
  it("markdown index and llms.txt mention every endpoint and the MCP url", () => {
    const md = mdIndex(base, c); const txt = llmsTxt(base, c);
    for (const e of ENDPOINTS) { expect(md).toContain(`### GET ${e.path}`); expect(txt).toContain(`${base}${e.path}`); }
    expect(md).toContain("`search_posts`"); expect(txt).toContain(`${base}/api/mcp`); expect(txt.startsWith("# research.nalenz.org\n\n> ")).toBe(true); expect(txt).toContain(c.researchQuestion.text); expect(llmsTxt(base, null)).not.toContain("Snapshot:");
  });
  it("openapi has every path, parameters, components and markdown media types", () => {
    const o = openapi(base); expect(o.openapi).toBe("3.1.0"); expect(o.servers).toEqual([{ url: base }]); expect(Object.keys(o.paths).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
    const posts = (o.paths["/api/v1/posts"] as { get: { parameters: { name: string }[]; operationId: string; responses: Record<string, { content: Record<string, unknown> }> } }).get; expect(posts.operationId).toBe("posts"); expect(posts.parameters.map((p) => p.name)).toContain("minGrade"); expect(Object.keys(posts.responses[200].content)).toEqual(["application/json", "text/markdown"]);
    expect((o.paths["/api/v1/posts/{id}"] as { get: { operationId: string; responses: Record<string, unknown> } }).get.operationId).toBe("posts_ById"); expect((o.paths["/api/v1/posts/{id}"] as { get: { responses: Record<string, unknown> } }).get.responses[404]).toBeDefined();
    expect(Object.keys(o.components.schemas)).toEqual(["Post", "PageInfo", "SnapshotInfo", "Error", "Theme", "Topic", "Question"]); expect((o.components.schemas.Post as { required: string[] }).required).toContain("relevance"); expect(JSON.stringify(o)).not.toContain("$schema");
    expect((o.components.schemas.Post as Record<string, unknown>).additionalProperties).toBeUndefined();   // Post is extended with allOf (score, distance, neighbors)
    const theme = (o.paths["/api/v1/themes/{id}"] as { get: { responses: Record<string, { content: Record<string, { schema: { properties: { data: { allOf: unknown[] } } } }> }> } }).get.responses[200].content["application/json"].schema; expect(theme.properties.data.allOf).toHaveLength(2);
    expect(Object.keys((o.paths["/api/v1/export"] as { get: { responses: Record<string, { content: Record<string, unknown> }> } }).get.responses[200].content)).toEqual(["application/json", "text/markdown", "application/jsonl"]);
    expect(indexDoc(base, c).endpoints.find((e) => e.path === "/api/v1/export")!.formats).toEqual(["md", "jsonl", "json"]); expect(indexDoc(base, c).endpoints.find((e) => e.path === "/api/v1/questions/{id}")!.example).not.toContain("minGrade");
  });
});
