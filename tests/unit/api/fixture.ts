import { buildSnapshot } from "@/lib/snapshot";
import { buildCorpus } from "@/lib/api/corpus";
import type { Enrichment, Item, Layout, Question, Relation } from "@/lib/types";

/** A tiny deterministic snapshot: 2 themes, 3 topics, 7 posts (one unclustered, one ungraded, one the research question). */
export function makeSnapshot() {
  const day = 86400_000; const t0 = Date.parse("2026-09-01T00:00:00Z");
  const mk = (i: number, kind: Item["kind"], extra: Partial<Item> = {}): Item => ({ xId: `100${i}`, text: `post ${i} text`, createdAt: new Date(t0 + i * day), kind, urls: [], media: [], isResearchQuestion: false, stage: "graded", fetchedAt: new Date(t0 + i * day), ...extra });
  const items: Item[] = [
    mk(0, "text", { isResearchQuestion: true }), mk(1, "link", { urls: [{ url: "https://t.co/a", expandedUrl: "https://arxiv.org/abs/1", domain: "arxiv.org", isMedia: false }] }),
    mk(2, "media", { lang: "de" }), mk(3, "text"), mk(4, "selfReply", { parentId: "1003" }), mk(5, "link", { urls: [{ url: "https://t.co/b", expandedUrl: "https://example.org/x", domain: "example.org", isMedia: false }] }), mk(6, "quote"),
  ];
  const clusters = [{ id: 0, label: "Formal Foundations", themeId: 0, size: 3, x: 0, y: 0 }, { id: 1, label: "Law as Code", themeId: 0, size: 2, x: 10, y: 0 }, { id: 2, label: "Consent", themeId: 1, size: 1, x: 0, y: 10 }];
  const pos = [[0, 0, 0], [0.5, 0, 0], [1, 0, 0], [10, 0, 1], [10.5, 0, 1], [0, 10, 2], [20, 20, -1]];
  const layout: Layout = {
    version: 7, createdAt: new Date(t0), method: "fixture", status: "published",
    points: items.map((it, i) => ({ xId: it.xId, x: pos[i][0], y: pos[i][1], clusterId: pos[i][2], provisional: i === 4 })), labels: [],
    themes: [{ id: 0, label: "Making structures explicit", clusterIds: [0, 1] }, { id: 1, label: "Changing structures", clusterIds: [2] }], clusters, hulls: [], procrustesResidual: null,
  };
  const enrichment = new Map<string, Enrichment>(items.map((it, i) => [it.xId, {
    xId: it.xId, source: "none", thin: false, needsContent: false, fetchedAt: new Date(t0), thumbUrl: i === 2 ? "https://blob/thumb2.png" : undefined,
    normalized: { title: `Title ${i} | pipe`, summaryEn: `Summary ${i} about ${i % 2 ? "ontologies" : "consent"}.`, gist: `Gist ${i}`, tagsEn: [`tag${i}`, "shared"], language: it.lang === "de" ? "de" : "en", entities: [], contentKind: "thought" },
  }]));
  const questions: Question[] = [{ _id: "core", text: "Core question", parentId: null, validFrom: new Date(t0), validTo: null, origin: "seed" }, { _id: "seed-1", text: "How can structures be explicit?", parentId: "core", validFrom: new Date(t0), validTo: null, origin: "seed" }, { _id: "seed-2", text: "How can structures be changeable?", parentId: "core", validFrom: new Date(t0), validTo: null, origin: "seed" }, { _id: "old", text: "Retired", parentId: "core", validFrom: new Date(t0), validTo: new Date(t0), origin: "induced" }];
  const grades = [3, 3, 2, 1, 0, 2, -1]; const roles: Relation["role"][] = ["evidence", "example", "tool", "tangent", "unrelated", "inspiration", "evidence"];
  const relations = new Map<string, Relation[]>(items.map((it, i) => [it.xId, grades[i] < 0 ? [] : [
    { xId: it.xId, questionId: "core", role: roles[i], grade: grades[i], rationale: `because ${i}`, cosine: 0.3, modelVersion: "fx", disagreement: false },
    ...(i % 2 ? [{ xId: it.xId, questionId: "seed-1", role: "example" as const, grade: 2, rationale: "", cosine: 0.2, modelVersion: "fx", disagreement: false }] : []),
  ]]));
  const snap = buildSnapshot({ layout, items, enrichment, relations, questions, overrides: [], generatedAt: new Date("2026-11-02T04:00:00Z") });
  const manifest = { _id: "current" as const, layoutVersion: 7, pointsUrl: "/p", metaUrl: "/m", labelsUrl: "/l", generatedAt: new Date("2026-11-02T04:00:00Z"), count: snap.points.count, embeddingModel: "text-embedding-3-large@1024" };
  return { ...snap, manifest };
}
export const CORE = "How can we make coordination structures explicit?";
export function makeCorpus() { const s = makeSnapshot(); return buildCorpus({ points: s.points, meta: s.meta, labels: s.labels, manifest: s.manifest, coreQuestion: CORE, researchQuestionPostId: "1000" }); }
