import type { LabelsFile, MetaFile, PointsFile } from "../snapshot";
import type { Manifest } from "../types";
import { GRADE_WORDS, type PostFilter } from "./schemas";

export interface Ref { id: number; label: string }
export interface QuestionRef { id: string; text: string }
export interface Post {
  id: string; url: string; createdAt: string; kind: string; language: string; title: string; summary: string; tags: string[];
  link: { url: string; domain: string } | null; thumbnail: string | null;
  theme: Ref | null; topic: Ref | null;
  relevance: { grade: 0 | 1 | 2 | 3 | null; label: (typeof GRADE_WORDS)[number] | "ungraded"; role: string; rationale: string };
  subQuestions: QuestionRef[]; position: { x: number; y: number; provisional: boolean }; isResearchQuestion: boolean;
}
export interface Topic extends Ref { themeId: number; size: number; x: number; y: number; meanGrade: number | null }
export interface Theme extends Ref { topics: Topic[]; size: number }
export interface Question extends QuestionRef { parentId: string | null; count: number }
export interface SnapshotInfo { layoutVersion: number; generatedAt: string; count: number; embeddingModel: string }
export interface Corpus {
  snapshot: SnapshotInfo; researchQuestion: { text: string; postId: string | null };
  posts: Post[]; byId: Map<string, Post>; themes: Theme[]; topics: Topic[]; questions: Question[];
}

export const X_HANDLE = "sigalor";
export const postUrl = (id: string) => `https://x.com/${X_HANDLE}/status/${id}`;
export const gradeWord = (g: number): Post["relevance"]["label"] => (g >= 0 && g <= 3 ? GRADE_WORDS[g] : "ungraded");

/** Row-oriented view of one columnar snapshot. Pure. `coreQuestion` is the research question text (the snapshot only stores "core" as an id). */
export function buildCorpus(input: { points: PointsFile; meta: MetaFile; labels: LabelsFile; manifest: Pick<Manifest, "layoutVersion" | "generatedAt" | "embeddingModel">; coreQuestion: string; researchQuestionPostId?: string }): Corpus {
  const { points: p, meta: m, labels: l } = input;
  const metaIdx = new Map(m.ids.map((id, i) => [id, i]));
  const themeById = new Map<number, Ref>(p.themes.map((t) => [t.id, { id: t.id, label: t.label }]));
  const topicById = new Map<number, Ref>(p.leaves.map((c) => [c.id, { id: c.id, label: c.label }]));
  const qText = new Map(l.questions.map((q) => [q.id, q.id === "core" ? input.coreQuestion : q.text]));
  const qCount = new Map<string, number>(); const gradeSum = new Map<number, [number, number]>();
  const posts: Post[] = []; let rqId: string | null = null;
  for (let i = 0; i < p.count; i++) {
    const id = p.ids[i]; const mi = metaIdx.get(id); const grade = p.grade[i]; const g = grade >= 0 ? (grade as 0 | 1 | 2 | 3) : null;
    const isRQ = id === input.researchQuestionPostId; if (isRQ) rqId = id;
    const subQ = mi === undefined ? [] : m.subQuestions[mi].map((qid) => ({ id: qid, text: qText.get(qid) ?? qid }));
    const url = mi === undefined ? null : m.url[mi]; const domain = mi === undefined ? null : m.domain[mi];
    posts.push({
      id, url: postUrl(id), createdAt: new Date(p.createdAt[i] * 1000).toISOString(), kind: p.kinds[p.kind[i]] ?? "text", language: mi === undefined ? "und" : m.lang[mi],
      title: mi === undefined ? "" : m.title[mi], summary: mi === undefined ? "" : m.gist[mi], tags: mi === undefined ? [] : m.tags[mi],
      link: url ? { url, domain: domain ?? safeDomain(url) } : null, thumbnail: mi === undefined ? null : m.thumb[mi],
      theme: themeById.get(p.theme[i]) ?? null, topic: topicById.get(p.leaf[i]) ?? null,
      relevance: isRQ && (mi === undefined || m.role[mi] === "ungraded")
        ? { grade: g, label: gradeWord(grade), role: "question", rationale: "This post is the research question itself." }   // the pipeline never grades the question against itself
        : { grade: g, label: gradeWord(grade), role: mi === undefined ? "ungraded" : m.role[mi], rationale: mi === undefined ? "" : m.rationale[mi] },
      subQuestions: subQ, position: { x: p.x[i], y: p.y[i], provisional: p.provisional[i] === 1 }, isResearchQuestion: isRQ,
    });
    if (g !== null) { qCount.set("core", (qCount.get("core") ?? 0) + 1); const gs = gradeSum.get(p.leaf[i]) ?? [0, 0]; gs[0] += g; gs[1]++; gradeSum.set(p.leaf[i], gs); }
    for (const q of subQ) qCount.set(q.id, (qCount.get(q.id) ?? 0) + 1);
  }
  const topics: Topic[] = p.leaves.map((c) => { const gs = gradeSum.get(c.id); return { id: c.id, label: c.label, themeId: c.themeId, size: c.size, x: c.x, y: c.y, meanGrade: gs && gs[1] ? round(gs[0] / gs[1], 2) : null }; });
  const themes: Theme[] = p.themes.map((t) => { const ts = topics.filter((c) => c.themeId === t.id); return { id: t.id, label: t.label, topics: ts, size: ts.reduce((a, c) => a + c.size, 0) }; });
  const questions: Question[] = l.questions.map((q) => ({ id: q.id, text: qText.get(q.id) ?? q.text, parentId: q.parentId, count: qCount.get(q.id) ?? 0 }));
  return {
    snapshot: { layoutVersion: input.manifest.layoutVersion, generatedAt: new Date(input.manifest.generatedAt).toISOString(), count: posts.length, embeddingModel: input.manifest.embeddingModel },
    researchQuestion: { text: input.coreQuestion, postId: rqId }, posts, byId: new Map(posts.map((x) => [x.id, x])), themes, topics, questions,
  };
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
function safeDomain(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

/** Apply every filter; unknown ids simply match nothing. */
export function filterPosts(posts: Post[], f: Partial<PostFilter>): Post[] {
  const since = f.since ? Date.parse(f.since) : null; const until = f.until ? Date.parse(f.until) : null; const q = f.q?.toLowerCase();
  return posts.filter((p) => {
    if (f.theme !== undefined && p.theme?.id !== f.theme) return false;
    if (f.topic !== undefined && (p.topic?.id ?? -1) !== f.topic) return false;
    if (f.question !== undefined && !(f.question === "core" ? p.relevance.grade !== null : p.subQuestions.some((s) => s.id === f.question))) return false;
    if (f.minGrade !== undefined && (p.relevance.grade === null || p.relevance.grade < f.minGrade)) return false;
    if (f.role !== undefined && p.relevance.role !== f.role) return false;
    if (f.kind !== undefined && p.kind !== f.kind) return false;
    if (f.language !== undefined && p.language !== f.language) return false;
    const t = Date.parse(p.createdAt); if (since !== null && t < since) return false; if (until !== null && t >= until) return false;
    if (q && !(p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.tags.some((x) => x.toLowerCase().includes(q)))) return false;
    return true;
  });
}
export function sortPosts(posts: Post[], sort: PostFilter["sort"] = "newest"): Post[] {
  const byTime = (a: Post, b: Post) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  if (sort === "oldest") return [...posts].sort((a, b) => -byTime(a, b));
  if (sort === "relevance") return [...posts].sort((a, b) => (b.relevance.grade ?? -1) - (a.relevance.grade ?? -1) || byTime(a, b));
  return [...posts].sort(byTime);
}
export function paginate<T>(rows: T[], page: { limit: number; offset: number }) {
  const data = rows.slice(page.offset, page.offset + page.limit); const nextOffset = page.offset + page.limit;
  return { data, page: { limit: page.limit, offset: page.offset, total: rows.length, nextOffset: nextOffset < rows.length ? nextOffset : null } };
}
/** k nearest posts on the terrain by Euclidean distance; never the post itself. */
export function nearest(corpus: Corpus, post: Post, k: number): (Post & { distance: number })[] {
  if (k <= 0) return [];
  const out: (Post & { distance: number })[] = [];
  for (const p of corpus.posts) { if (p.id === post.id) continue; const d = Math.hypot(p.position.x - post.position.x, p.position.y - post.position.y); out.push({ ...p, distance: round(d, 4) }); }
  return out.sort((a, b) => a.distance - b.distance).slice(0, k);
}
export function distribution<T extends string | number>(posts: Post[], key: (p: Post) => T): Record<string, number> {
  const d: Record<string, number> = {}; for (const p of posts) { const k = String(key(p)); d[k] = (d[k] ?? 0) + 1; } return d;
}
