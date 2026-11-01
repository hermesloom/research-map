import { describe, it, expect } from "vitest";
import { gradeItem, CORE_QUESTION, SEED_SUBQUESTIONS, pickCandidates } from "@/lib/llm/grade";
process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k";
const q = (id: string, text: string, v: number[]) => ({ _id: id, text, parentId: id === "core" ? null : "core", embedding: v, validFrom: new Date(), validTo: null, origin: "seed" } as any);
const item = { xId: "7", text: "Authority should be explicit, local, and revocable", kind: "text", urls: [], media: [], createdAt: new Date(), isResearchQuestion: false, stage: "embedded", fetchedAt: new Date() } as any;
const norm = { title: "Explicit authority", summaryEn: "Argues authority should be explicit and revocable.", gist: "", tagsEn: [], language: "en", entities: [], contentKind: "thought" } as any;

describe("grade", () => {
  it("has the verbatim core question and six seeds", () => { expect(CORE_QUESTION).toMatch(/without requiring everyone to agree/); expect(SEED_SUBQUESTIONS.length).toBe(6); });
  it("picks core + 3 nearest sub-questions", () => {
    const qs = [q("core", "c", [1, 0, 0]), q("a", "a", [0, 1, 0]), q("b", "b", [0, 0.9, 0.1]), q("c", "c2", [0, 0, 1]), q("d", "d", [0.1, 0.9, 0])];
    const c = pickCandidates([0, 1, 0], qs); expect(c[0]._id).toBe("core"); expect(c.length).toBe(4); expect(c.map((x) => x._id)).not.toContain("c");
  });
  it("writes a core relation plus sub-question relations and flags disagreement", async () => {
    const qs = [q("core", "c", [1, 0]), q("a", "a", [0, 1])];
    const deps = { parse: async () => ({ grade: 3, role: "evidence", rationale: "direct statement about explicit structures", subQuestionIds: ["a"] }) } as any;
    const r = await gradeItem(item, norm, [0, 1], qs, deps);
    expect(r.relations.map((x) => x.questionId).sort()).toEqual(["a", "core"]);
    expect(r.relations.find((x) => x.questionId === "core")!.disagreement).toBe(true); // grade 3 but cosine 0 to core
  });
  it("ignores sub-question ids the model invents", async () => {
    const qs = [q("core", "c", [1, 0]), q("a", "a", [0, 1])];
    const r = await gradeItem(item, norm, [1, 0], qs, { parse: async () => ({ grade: 1, role: "tangent", rationale: "x", subQuestionIds: ["zzz"] }) } as any);
    expect(r.relations.length).toBe(1);
  });
});
