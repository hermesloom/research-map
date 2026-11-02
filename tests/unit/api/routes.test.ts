import { describe, it, expect, vi } from "vitest";
vi.mock("next/server", () => ({ connection: async () => {} }));
import { makeCorpus } from "./fixture";
import { routes } from "@/lib/api/routes";
import { NoSnapshotError } from "@/lib/api/loader";

const c = makeCorpus(); const ok = { configured: () => true, embed: async () => [[1]], knn: async () => [{ xId: "1001", score: 0.9 }, { xId: "1005", score: 0.4 }] };
const r = routes({ corpus: async () => c, search: ok });
const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${path}`, { headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/llms.txt and /api/v1", () => {
  it("llms.txt is plain text with the question and endpoints", async () => { const res = await r.llms(req("/llms.txt")); expect(res.headers.get("content-type")).toMatch(/text\/plain/); const t = await res.text(); expect(t).toContain(c.researchQuestion.text); expect(t).toContain("http://localhost:3000/api/v1/posts"); });
  it("llms.txt still answers without a snapshot", async () => { const res = await routes({ corpus: async () => { throw new NoSnapshotError("x"); } }).llms(req("/llms.txt")); expect(res.status).toBe(200); expect(await res.text()).toContain("## API"); });
  it("index negotiates json and markdown", async () => {
    const j = await (await r.index(req("/api/v1"))).json(); expect(j.endpoints.length).toBeGreaterThan(10); expect(j.mcp.url).toBe("http://localhost:3000/api/mcp"); expect(j.snapshot.count).toBe(7);
    const m = await r.index(req("/api/v1?format=md")); expect(m.headers.get("content-type")).toMatch(/markdown/); expect(await m.text()).toContain("### GET /api/v1/search");
  });
  it("openapi.json is served", async () => { const j = await (await r.openapi(req("/api/v1/openapi.json"))).json(); expect(j.openapi).toBe("3.1.0"); expect(j.servers[0].url).toBe("http://localhost:3000"); });
});
describe("collections", () => {
  it("overview, themes, topics, questions in both formats", async () => {
    expect((await (await r.overview(req("/api/v1/overview"))).json()).counts.posts).toBe(7); expect(await (await r.overview(req("/api/v1/overview", { accept: "text/markdown" }))).text()).toContain("## Research question");
    const th = await (await r.themes(req("/api/v1/themes"))).json(); expect(th.data.map((t: { label: string }) => t.label)).toEqual(["Making structures explicit", "Changing structures"]); expect(th.snapshot.layoutVersion).toBe(7);
    expect(await (await r.topics(req("/api/v1/topics?format=md"))).text()).toContain("- **Law as Code** (topic 1, theme 0, 2 posts");
    expect((await (await r.questions(req("/api/v1/questions"))).json()).data).toHaveLength(3);
  });
  it("theme/topic/question detail pages with next links; 404 and 400 on bad ids", async () => {
    const t = await (await r.theme(req("/api/v1/themes/0?limit=2"), ctx("0"))).json(); expect(t.data.posts).toHaveLength(2); expect(t.page).toEqual({ limit: 2, offset: 0, total: 5, next: "http://localhost:3000/api/v1/themes/0?limit=2&offset=2" });
    expect((await r.theme(req("/api/v1/themes/9"), ctx("9"))).status).toBe(404); const bad = await r.theme(req("/api/v1/themes/x"), ctx("x")); expect(bad.status).toBe(400); expect((await bad.json()).error.hint).toMatch(/integers/);
    expect((await (await r.topic(req("/api/v1/topics/2"), ctx("2"))).json()).data.theme.label).toBe("Changing structures"); expect((await r.topic(req("/api/v1/topics/77"), ctx("77"))).status).toBe(404);
    const q = await (await r.question(req("/api/v1/questions/seed-1?format=md"), ctx("seed-1"))).text(); expect(q).toContain("# Question seed-1"); expect(q).toContain("3 posts; showing 1–3."); expect((await r.question(req("/api/v1/questions/zzz"), ctx("zzz"))).status).toBe(404);
  });
});
describe("/api/v1/posts", () => {
  it("lists with filters and pagination", async () => {
    const res = await r.posts(req("/api/v1/posts?minGrade=2&limit=3&sort=oldest")); const j = await res.json(); expect(j.data.map((p: { id: string }) => p.id)).toEqual(["1000", "1001", "1002"]); expect(j.page.next).toBe("http://localhost:3000/api/v1/posts?minGrade=2&limit=3&sort=oldest&offset=3"); expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
    const last = await (await r.posts(req(j.page.next.replace("http://localhost:3000", "")))).json(); expect(last.data).toHaveLength(1); expect(last.page.next).toBeNull();
  });
  it("400 on an unknown parameter (typos never return the unfiltered corpus)", async () => { const res = await r.posts(req("/api/v1/posts?min_grade=3")); expect(res.status).toBe(400); expect((await res.json()).error.message).toMatch(/Unknown query parameter: min_grade/); });
  it("400 with hint on a bad parameter", async () => { const res = await r.posts(req("/api/v1/posts?kind=video")); expect(res.status).toBe(400); const e = (await res.json()).error; expect(e.code).toBe("bad_request"); expect(e.hint).toMatch(/^kind: /); expect(e.docs).toBe("http://localhost:3000/api/v1"); });
  it("detail with neighbours; 404 for unknown", async () => {
    const j = await (await r.post(req("/api/v1/posts/1000?neighbors=2"), ctx("1000"))).json(); expect(j.data.title).toBe("Title 0 | pipe"); expect(j.data.neighbors.map((n: { id: string }) => n.id)).toEqual(["1001", "1002"]);
    expect(await (await r.post(req("/api/v1/posts/1000?format=md"), ctx("1000"))).text()).toContain("# Title 0 | pipe"); expect((await r.post(req("/api/v1/posts/404"), ctx("404"))).status).toBe(404);
  });
  it("503 with a stable envelope when no snapshot exists", async () => { const res = await routes({ corpus: async () => { throw new NoSnapshotError("x"); } }).posts(req("/api/v1/posts")); expect(res.status).toBe(503); expect((await res.json()).error.code).toBe("no_snapshot"); });
});
describe("/api/v1/search and /api/v1/export", () => {
  it("search returns scored posts, cached for an hour", async () => { const res = await r.search(req("/api/v1/search?q=consent&limit=5")); const j = await res.json(); expect(j.query).toBe("consent"); expect(j.data.map((p: { id: string; score: number }) => [p.id, p.score])).toEqual([["1001", 0.9], ["1005", 0.4]]); expect(res.headers.get("cache-control")).toMatch(/s-maxage=3600/); });
  it("search without q → 400; unavailable backend → 503 with the lexical hint", async () => {
    expect((await r.search(req("/api/v1/search"))).status).toBe(400); const res = await routes({ corpus: async () => c, search: { ...ok, configured: () => false } }).search(req("/api/v1/search?q=x")); expect(res.status).toBe(503); expect((await res.json()).error.hint).toMatch(/\/api\/v1\/posts\?q=/);
  });
  it("export as markdown (default), jsonl and json", async () => {
    const md = await r.export(req("/api/v1/export")); expect(md.headers.get("content-type")).toMatch(/markdown/); expect(await md.text()).toContain("# research.nalenz.org — 7 posts");
    const jl = await r.export(req("/api/v1/export?format=jsonl&theme=1")); expect(jl.headers.get("content-type")).toMatch(/jsonl/); const lines = (await jl.text()).trim().split("\n"); expect(lines).toHaveLength(1); expect(JSON.parse(lines[0]).id).toBe("1005");
    const js = await (await r.export(req("/api/v1/export?format=json&limit=2"))).json(); expect(js).toHaveLength(2); expect(jl.headers.get("cache-control")).toMatch(/s-maxage=300/);
    const page2 = await (await r.export(req("/api/v1/export?format=json&limit=2&offset=6"))).json(); expect(page2).toHaveLength(1); expect((await r.export(req("/api/v1/export?limit=99999"))).status).toBe(400);
  });
});
