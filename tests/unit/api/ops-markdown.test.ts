import { describe, it, expect } from "vitest";
import { makeCorpus } from "./fixture";
import { overview, listPosts, getPost, getTheme, getTopic, getQuestion, exportPosts } from "@/lib/api/ops";
import { mdPost, mdOverview, mdExport, mdPage, mdPostDetail, mdSearch } from "@/lib/api/markdown";
import { PostSchema } from "@/lib/api/schemas";

const c = makeCorpus();
describe("ops", () => {
  it("overview aggregates", () => {
    const o = overview(c); expect(o.counts).toEqual({ posts: 7, graded: 6, provisional: 1, unclustered: 1, themes: 2, topics: 3 });
    expect(o.dateRange).toEqual({ first: "2026-09-01T00:00:00.000Z", last: "2026-09-07T00:00:00.000Z" }); expect(o.kinds.link).toBe(2); expect(o.roles.unrelated).toBe(1);
    expect(o.themes[0].topics.map((t) => t.label)).toEqual(["Formal Foundations", "Law as Code"]); expect(o.researchQuestion.postId).toBe("1000");
  });
  it("listPosts filters, sorts and pages", () => {
    const r = listPosts(c, { minGrade: 2, sort: "oldest" }, { limit: 2, offset: 1 }); expect(r.data.map((p) => p.id)).toEqual(["1001", "1002"]); expect(r.page).toEqual({ limit: 2, offset: 1, total: 4, nextOffset: 3 });
  });
  it("getPost with neighbours; unknown id → null", () => {
    const r = getPost(c, "1003", 1)!; expect(r.post.title).toBe("Title 3 | pipe"); expect(r.neighbors.map((n) => n.id)).toEqual(["1004"]); expect(getPost(c, "x", 1)).toBeNull();
  });
  it("theme, topic, question pages sorted by relevance", () => {
    expect(getTheme(c, 0, { limit: 50, offset: 0 })!.posts.data.map((p) => p.id)).toEqual(["1001", "1000", "1002", "1003", "1004"]); expect(getTheme(c, 9, { limit: 1, offset: 0 })).toBeNull();
    const t = getTopic(c, 2, { limit: 50, offset: 0 })!; expect(t.theme!.label).toBe("Changing structures"); expect(t.posts.data.map((p) => p.id)).toEqual(["1005"]);
    const q = getQuestion(c, "core", { limit: 50, offset: 0 })!; expect(q.children.map((x) => x.id)).toEqual(["seed-1", "seed-2"]); expect(q.posts.page.total).toBe(6);
    expect(getQuestion(c, "seed-2", { limit: 50, offset: 0 })!.posts.page.total).toBe(0);
  });
  it("export caps and filters", () => { expect(exportPosts(c, { theme: 0 }, 2)).toHaveLength(2); expect(exportPosts(c, {}, 100)).toHaveLength(7); });
  it("every post validates against the published PostSchema", () => { for (const p of c.posts) expect(PostSchema.safeParse(p).success).toBe(true); });
});
describe("markdown", () => {
  it("renders a post as a heading plus facts", () => {
    const md = mdPost(c.byId.get("1001")!);
    expect(md).toContain("### Title 1 | pipe"); expect(md).toContain("- id: 1001 · https://x.com/sigalor/status/1001"); expect(md).toContain("- 2026-09-02 · link · en"); expect(md).toContain("- link: https://arxiv.org/abs/1 (arxiv.org)");
    expect(md).toContain("- where: Making structures explicit › Formal Foundations"); expect(md).toContain("- relevance: core (3), role example — because 1"); expect(md).toContain("- sub-questions: How can structures be explicit?"); expect(md).toContain("- tags: tag1, shared"); expect(md.trim().endsWith("Summary 1 about ontologies.")).toBe(true);
  });
  it("marks ungraded, unclustered, provisional and the research question", () => {
    expect(mdPost(c.byId.get("1006")!)).toContain("- where: unclustered"); expect(mdPost(c.byId.get("1006")!)).toContain("- relevance: ungraded");
    expect(mdPost(c.byId.get("1004")!)).toContain("(provisional)"); expect(mdPost(c.byId.get("1000")!)).toContain("**the research question post**");
  });
  it("overview lists themes, topics and sub-questions", () => {
    const md = mdOverview(overview(c), c); expect(md).toContain(`> ${c.researchQuestion.text}`); expect(md).toContain("- **Making structures explicit** (theme 0, 5 posts)"); expect(md).toContain("  - Formal Foundations (topic 0, 3 posts, mean grade 2.67)");
    expect(md).toContain("- How can structures be changeable? (question seed-2, 0 posts)"); expect(md).not.toContain("question core");
  });
  it("export groups theme → topic → posts with unclustered last", () => {
    const md = mdExport(exportPosts(c, {}, 100), c); const i = (s: string) => md.indexOf(s);
    expect(i("## Making structures explicit")).toBeGreaterThan(0); expect(i("### Formal Foundations")).toBeLessThan(i("### Law as Code")); expect(i("## Changing structures")).toBeLessThan(i("## Unclustered")); expect(md).toContain("#### Title 6 | pipe");
  });
  it("page, detail and search renderers include the snapshot line and next link", () => {
    const r = listPosts(c, {}, { limit: 2, offset: 0 }); const md = mdPage("Posts", r, c, "http://x/next"); expect(md).toContain("7 posts; showing 1–2."); expect(md).toContain("Next page: http://x/next"); expect(md).toContain("_Snapshot: layout v7");
    const d = getPost(c, "1000", 2)!; expect(mdPostDetail(d.post, d.neighbors, c)).toContain("## Nearest on the map (2)");
    expect(mdSearch("consent", [{ ...c.byId.get("1000")!, score: 0.5 }], c)).toContain("score 0.500"); expect(mdSearch("zzz", [], c)).toContain("No results.");
  });
});
