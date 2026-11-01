import type { Enrichment, Item, Layout, Override, Question, Relation } from "./types";
import { applyOverrides } from "./overrides";

export const KINDS = ["text", "link", "media", "selfReply", "quote", "replyToOther", "retweet"] as const;
export type LabelContent = string | { image: string; width: number; height: number };
export interface LabelsFile {
  version: 1;
  labels: { x: number; y: number; content: LabelContent; level: number; priority: number }[];
  hulls: { clusterId: number; polygon: [number, number][] }[];
  questions: { id: string; text: string; parentId: string | null }[];
}

/** Columnar, CDN-friendly snapshot of one published layout. Pure: no I/O. */
export function buildSnapshot(input: { layout: Layout; items: Item[]; enrichment: Map<string, Enrichment>; relations: Map<string, Relation[]>; questions: Question[]; overrides: Override[]; generatedAt: Date }) {
  const layout = applyOverrides(input.layout, input.overrides);
  const live = new Map(input.items.filter((i) => !i.deletedAt).map((i) => [i.xId, i]));
  const pts = layout.points.filter((p) => live.has(p.xId));
  const themeOfCluster = new Map<number, number>(); for (const t of layout.themes) for (const c of t.clusterIds) themeOfCluster.set(c, t.id);
  const points = {
    version: 1 as const, layoutVersion: layout.version, generatedAt: input.generatedAt.toISOString(), count: pts.length,
    ids: [] as string[], x: [] as number[], y: [] as number[], leaf: [] as number[], theme: [] as number[], grade: [] as number[], provisional: [] as number[], createdAt: [] as number[], kind: [] as number[],
    themes: layout.themes.map((t) => ({ id: t.id, label: t.label })),
    leaves: layout.clusters.map((c) => ({ id: c.id, label: c.label, themeId: c.themeId, x: c.x, y: c.y, size: c.size })),
    kinds: [...KINDS],
  };
  const meta = { version: 1 as const, ids: [] as string[], title: [] as string[], gist: [] as string[], url: [] as (string | null)[], domain: [] as (string | null)[], thumb: [] as (string | null)[], role: [] as string[], rationale: [] as string[], tags: [] as string[][], lang: [] as string[], subQuestions: [] as string[][] };
  const labels: LabelsFile["labels"] = [];
  const gradeSum = new Map<number, [number, number]>();
  for (const p of pts) {
    const it = live.get(p.xId)!; const en = input.enrichment.get(p.xId); const rels = input.relations.get(p.xId) ?? []; const core = rels.find((r) => r.questionId === "core");
    const grade = it.isResearchQuestion ? 3 : core?.grade ?? -1; const role = core?.role ?? "ungraded";   // -1 = not graded yet; never fabricate a grade
    points.ids.push(p.xId); points.x.push(p.x); points.y.push(p.y); points.leaf.push(p.clusterId); points.theme.push(themeOfCluster.get(p.clusterId) ?? -1); points.grade.push(grade);
    points.provisional.push(p.provisional ? 1 : 0); points.createdAt.push(Math.floor(it.createdAt.getTime() / 1000)); points.kind.push(Math.max(0, KINDS.indexOf(it.kind)));
    const n = en?.normalized; const firstUrl = it.urls.find((u) => !u.isMedia);
    const title = n?.title ?? en?.title ?? it.text.slice(0, 80);
    meta.ids.push(p.xId); meta.title.push(title); meta.gist.push(n?.gist ?? it.text.slice(0, 280)); meta.url.push(firstUrl?.expandedUrl ?? null); meta.domain.push(firstUrl?.domain ?? null);
    meta.thumb.push(en?.thumbUrl ?? en?.ogImage ?? null); meta.role.push(role); meta.rationale.push(core?.rationale ?? ""); meta.tags.push(n?.tagsEn ?? []); meta.lang.push(n?.language ?? it.lang ?? "und");
    meta.subQuestions.push(rels.filter((r) => r.questionId !== "core").map((r) => r.questionId));
    const gs = gradeSum.get(p.clusterId) ?? [0, 0]; if (grade >= 0) { gs[0] += grade; gs[1] += 1; } gradeSum.set(p.clusterId, gs);
    labels.push({ x: p.x, y: p.y, content: title, level: 2, priority: Math.max(0, grade) });
    if (en?.thumbUrl) labels.push({ x: p.x, y: p.y, content: { image: en.thumbUrl, width: 96, height: 64 }, level: 2, priority: Math.max(0, grade) + 0.5 });
  }
  for (const t of layout.themes) {
    const cs = layout.clusters.filter((c) => t.clusterIds.includes(c.id)); if (!cs.length) continue; const n = cs.reduce((a, c) => a + c.size, 0);
    labels.push({ x: cs.reduce((a, c) => a + c.x * c.size, 0) / n, y: cs.reduce((a, c) => a + c.y * c.size, 0) / n, content: t.label, level: 0, priority: 1000 + n });
  }
  for (const c of layout.clusters) { const gs = gradeSum.get(c.id) ?? [0, 1]; labels.push({ x: c.x, y: c.y, content: c.label, level: 1, priority: 100 + c.size * (1 + gs[0] / Math.max(1, gs[1])) }); }
  const labelsFile: LabelsFile = { version: 1, labels, hulls: layout.hulls, questions: input.questions.filter((q) => !q.validTo).map((q) => ({ id: q._id, text: q.text, parentId: q.parentId })) };
  return { points, meta, labels: labelsFile };
}
export type PointsFile = ReturnType<typeof buildSnapshot>["points"];
export type MetaFile = ReturnType<typeof buildSnapshot>["meta"];
