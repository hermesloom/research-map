import fs from "node:fs";
import path from "node:path";
import type { Item, Normalized, Question, Relation } from "../types";
import { GradeSchema } from "../types";
import { cosine } from "./embed";
import { parseStructured } from "./openai";
import { env } from "../env";

export const CORE_QUESTION = "How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?";
export const SEED_SUBQUESTIONS = [
  "How can coordination structures be made explicit?",
  "How can they be made understandable to the people living in them?",
  "How can different structures interoperate without a shared master representation?",
  "How can structures be changed by those affected, and legitimately?",
  "How can plural, non-universal representations of reality coexist and still coordinate?",
  "Who audits and trusts these structures, and how is that trust produced?",
];
type Anchors = { core: { xId: string; text: string }[]; adjacent: { xId: string; text: string }[]; unrelated: { xId: string; text: string }[] };
let anchorsCache: Anchors | null = null;
export function loadAnchors(): Anchors { return (anchorsCache ??= JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/anchors.json"), "utf8"))); }

export function pickCandidates(itemVector: number[], questions: Question[]): Question[] {
  const core = questions.find((q) => q._id === "core")!;
  const subs = questions.filter((q) => q._id !== "core" && !q.validTo && q.embedding);
  const nearest = subs.map((q) => [q, cosine(itemVector, q.embedding!)] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q]) => q);
  return [core, ...nearest];
}
export const GRADE_SYSTEM = `You grade how one post relates to a research question. Grade: 3 = directly addresses the question or a sub-question (evidence, worked example, tool built for it); 2 = clearly feeds into it (formal methods, knowledge representation, governance theory, infrastructure the question needs); 1 = loosely related intellectual interest; 0 = personal, humour, music, politics without structural content. Role: evidence, example, counterexample, tool, inspiration, extension, tangent, unrelated. Give a one-line rationale. subQuestionIds: pick at most 2 of the offered sub-question ids that the post genuinely speaks to (empty if grade ≤ 1).`;

export function buildGradeInput(item: Item, n: Normalized, candidates: Question[], anchors: Anchors) {
  const ex = (l: string, a: { text: string }[]) => `${l}:\n${a.slice(0, 5).map((x) => `- ${x.text.slice(0, 160)}`).join("\n")}`;
  const user = `Research question: ${CORE_QUESTION}\n\nSub-questions:\n${candidates.filter((c) => c._id !== "core").map((c) => `[${c._id}] ${c.text}`).join("\n")}\n\nCalibration examples from this author —\n${ex("Grade 3", anchors.core)}\n${ex("Grade 2", anchors.adjacent)}\n${ex("Grade 0", anchors.unrelated)}\n\nPost (${item.kind}, ${item.createdAt.toISOString().slice(0, 10)}):\nTitle: ${n.title}\nSummary: ${n.summaryEn}\nGist: ${n.gist}\nTags: ${n.tagsEn.join(", ")}`;
  return [{ role: "system" as const, content: GRADE_SYSTEM }, { role: "user" as const, content: user }];
}

export async function gradeItem(item: Item, n: Normalized, itemVector: number[], questions: Question[], deps = { parse: parseStructured }): Promise<{ relations: Relation[]; cosineToCore: number }> {
  const candidates = pickCandidates(itemVector, questions); const core = candidates[0];
  const cosineToCore = core.embedding ? cosine(itemVector, core.embedding) : 0;
  const g = await deps.parse(GradeSchema, "grade", buildGradeInput(item, n, candidates, loadAnchors()));
  const modelVersion = env().OPENAI_TEXT_MODEL; const valid = new Set(candidates.map((c) => c._id));
  const disagreement = (g.grade >= 2 && cosineToCore < 0.12) || (g.grade <= 0 && cosineToCore > 0.3);
  const relations: Relation[] = [{ xId: item.xId, questionId: "core", role: g.role, grade: g.grade, rationale: g.rationale, cosine: cosineToCore, modelVersion, disagreement }];
  for (const sid of g.subQuestionIds) if (valid.has(sid) && sid !== "core") {
    const sq = candidates.find((c) => c._id === sid)!;
    relations.push({ xId: item.xId, questionId: sid, role: g.role, grade: g.grade, rationale: g.rationale, cosine: sq.embedding ? cosine(itemVector, sq.embedding) : 0, modelVersion, disagreement: false });
  }
  return { relations, cosineToCore };
}
