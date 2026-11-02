import { describe, it, expect } from "vitest";
import { makeCorpus, makeSnapshot, CORE } from "./fixture";
import { buildCorpus } from "@/lib/api/corpus";
import { filterPosts, sortPosts, paginate, nearest, distribution } from "@/lib/api/corpus";

const c = makeCorpus();
describe("buildCorpus", () => {
  it("turns columns into rows with labels inlined", () => {
    expect(c.posts).toHaveLength(7); const p = c.byId.get("1001")!;
    expect(p.url).toBe("https://x.com/sigalor/status/1001"); expect(p.kind).toBe("link"); expect(p.title).toBe("Title 1 | pipe");
    expect(p.theme).toEqual({ id: 0, label: "Making structures explicit" }); expect(p.topic).toEqual({ id: 0, label: "Formal Foundations" });
    expect(p.link).toEqual({ url: "https://arxiv.org/abs/1", domain: "arxiv.org" }); expect(p.createdAt).toBe("2026-09-02T00:00:00.000Z");
    expect(p.relevance).toEqual({ grade: 3, label: "core", role: "example", rationale: "because 1" });
    expect(p.subQuestions).toEqual([{ id: "seed-1", text: "How can structures be explicit?" }]);
  });
  it("grade words, ungraded and unclustered", () => {
    expect(c.byId.get("1003")!.relevance.label).toBe("peripheral"); expect(c.byId.get("1004")!.relevance.label).toBe("unrelated"); expect(c.byId.get("1004")!.position.provisional).toBe(true);
    const u = c.byId.get("1006")!; expect(u.relevance).toEqual({ grade: null, label: "ungraded", role: "ungraded", rationale: "" }); expect(u.theme).toBeNull(); expect(u.topic).toBeNull();
  });
  it("research question post is flagged and carries the question text", () => {
    expect(c.byId.get("1000")!.isResearchQuestion).toBe(true); expect(c.researchQuestion.postId).toBe("1000"); expect(c.questions.find((q) => q.id === "core")!.text).toBe(c.researchQuestion.text);
  });
  it("an ungraded research question post gets role 'question' instead of 'ungraded' (production never grades it)", () => {
    const s = makeSnapshot(); const i = s.meta.ids.indexOf("1000"); s.meta.role[i] = "ungraded"; s.meta.rationale[i] = "";
    const c2 = buildCorpus({ points: s.points, meta: s.meta, labels: s.labels, manifest: s.manifest, coreQuestion: CORE, researchQuestionPostId: "1000" });
    expect(c2.byId.get("1000")!.relevance).toEqual({ grade: 3, label: "core", role: "question", rationale: "This post is the research question itself." });
  });
  it("themes, topics with mean grade, questions with counts (retired questions absent)", () => {
    expect(c.themes.map((t) => [t.label, t.size])).toEqual([["Making structures explicit", 5], ["Changing structures", 1]]);
    expect(c.topics.find((t) => t.id === 0)!.meanGrade).toBe(2.67); expect(c.topics.find((t) => t.id === 2)!.meanGrade).toBe(2);
    expect(c.questions.map((q) => [q.id, q.count])).toEqual([["core", 6], ["seed-1", 3], ["seed-2", 0]]);
    expect(c.snapshot).toEqual({ layoutVersion: 7, generatedAt: "2026-11-02T04:00:00.000Z", count: 7, embeddingModel: "text-embedding-3-large@1024" });
  });
  it("thumbnail is carried through", () => { expect(c.byId.get("1002")!.thumbnail).toBe("https://blob/thumb2.png"); expect(c.byId.get("1001")!.thumbnail).toBeNull(); });
});
describe("filterPosts", () => {
  const ids = (f: Parameters<typeof filterPosts>[1]) => filterPosts(c.posts, f).map((p) => p.id).sort();
  it("by theme, topic (incl. -1 unclustered), question", () => {
    expect(ids({ theme: 1 })).toEqual(["1005"]); expect(ids({ topic: 1 })).toEqual(["1003", "1004"]); expect(ids({ topic: -1 })).toEqual(["1006"]);
    expect(ids({ question: "seed-1" })).toEqual(["1001", "1003", "1005"]); expect(ids({ question: "core" })).toHaveLength(6); expect(ids({ question: "nope" })).toEqual([]);
  });
  it("by grade, role, kind, language", () => {
    expect(ids({ minGrade: 2 })).toEqual(["1000", "1001", "1002", "1005"]); expect(ids({ minGrade: 0 })).toHaveLength(6);
    expect(ids({ role: "tool" })).toEqual(["1002"]); expect(ids({ kind: "selfReply" })).toEqual(["1004"]); expect(ids({ language: "de" })).toEqual(["1002"]);
  });
  it("by date window (since inclusive, until exclusive) and lexical q", () => {
    expect(ids({ since: "2026-09-05", until: "2026-09-06T00:00:00Z" })).toEqual(["1004"]);
    expect(ids({ q: "ONTOLOGIES" })).toEqual(["1001", "1003", "1005"]); expect(ids({ q: "tag2" })).toEqual(["1002"]); expect(ids({ q: "Title 6" })).toEqual(["1006"]);
  });
  it("combines filters", () => { expect(ids({ theme: 0, minGrade: 3, kind: "link" })).toEqual(["1001"]); });
});
describe("sort, paginate, nearest, distribution", () => {
  it("sorts", () => {
    expect(sortPosts(c.posts, "newest")[0].id).toBe("1006"); expect(sortPosts(c.posts, "oldest")[0].id).toBe("1000");
    const r = sortPosts(c.posts, "relevance"); expect(r.slice(0, 2).map((p) => p.id)).toEqual(["1001", "1000"]); expect(r.at(-1)!.id).toBe("1006");
  });
  it("paginates with a next offset only when more rows exist", () => {
    const a = paginate(c.posts, { limit: 3, offset: 0 }); expect(a.data).toHaveLength(3); expect(a.page).toEqual({ limit: 3, offset: 0, total: 7, nextOffset: 3 });
    const b = paginate(c.posts, { limit: 3, offset: 6 }); expect(b.data).toHaveLength(1); expect(b.page.nextOffset).toBeNull();
    expect(paginate(c.posts, { limit: 3, offset: 99 }).data).toEqual([]);
  });
  it("nearest excludes self and orders by distance", () => {
    const n = nearest(c, c.byId.get("1000")!, 2); expect(n.map((p) => [p.id, p.distance])).toEqual([["1001", 0.5], ["1002", 1]]); expect(nearest(c, c.byId.get("1000")!, 0)).toEqual([]);
  });
  it("distribution", () => { expect(distribution(c.posts, (p) => p.relevance.label)).toEqual({ core: 2, adjacent: 2, peripheral: 1, unrelated: 1, ungraded: 1 }); });
});
