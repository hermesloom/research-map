import type { Corpus, Post, Question, Theme, Topic } from "./corpus";
import type { Overview, Paged } from "./ops";

/** Markdown renderers. Bullet lists rather than tables so titles with pipes or long text never break layout. */
const line = (s: string) => s.replace(/\s+/g, " ").trim();
const day = (iso: string) => iso.slice(0, 10);
export const grade = (p: Post) => p.relevance.grade === null ? "ungraded" : `${p.relevance.label} (${p.relevance.grade})`;

export function mdPost(p: Post, opts: { heading?: number; extra?: string } = {}): string {
  const h = "#".repeat(opts.heading ?? 3); const out: string[] = [`${h} ${line(p.title) || "(untitled)"}`, ""];
  out.push(`- id: ${p.id} · ${p.url}`);
  out.push(`- ${day(p.createdAt)} · ${p.kind} · ${p.language}${p.isResearchQuestion ? " · **the research question post**" : ""}${opts.extra ? ` · ${opts.extra}` : ""}`);
  if (p.link) out.push(`- link: ${p.link.url}${p.link.domain ? ` (${p.link.domain})` : ""}`);
  out.push(`- where: ${p.theme ? `${p.theme.label} › ${p.topic?.label ?? "?"}` : "unclustered"}${p.position.provisional ? " (provisional)" : ""}`);
  out.push(`- relevance: ${grade(p)}${p.relevance.grade !== null ? `, role ${p.relevance.role}${p.relevance.rationale ? ` — ${line(p.relevance.rationale)}` : ""}` : ""}`);
  if (p.subQuestions.length) out.push(`- sub-questions: ${p.subQuestions.map((q) => line(q.text)).join("; ")}`);
  if (p.tags.length) out.push(`- tags: ${p.tags.join(", ")}`);
  if (p.summary) out.push("", line(p.summary));
  return out.join("\n");
}
export function mdPostLine(p: Post, extra?: string): string {
  return `- **${line(p.title) || "(untitled)"}** (${day(p.createdAt)}, ${grade(p)}${extra ? `, ${extra}` : ""}) — ${line(p.summary)} · id ${p.id}`;
}
export function mdPage(title: string, r: Paged<Post>, c: Corpus, next: string | null, intro = ""): string {
  const out = [`# ${title}`, "", snapshotLine(c), ""]; if (intro) out.push(intro, "");
  out.push(`${r.page.total} post${r.page.total === 1 ? "" : "s"}; showing ${r.data.length ? `${r.page.offset + 1}–${r.page.offset + r.data.length}` : "none"}.`, "");
  for (const p of r.data) out.push(mdPost(p), "");
  if (next) out.push(`Next page: ${next}`);
  return out.join("\n").trimEnd() + "\n";
}
export const snapshotLine = (c: Corpus) => `_Snapshot: layout v${c.snapshot.layoutVersion}, generated ${c.snapshot.generatedAt}, ${c.snapshot.count} posts._`;

export function mdOverview(o: Overview, c: Corpus): string {
  const out = ["# research.nalenz.org — the map at a glance", "", snapshotLine(c), "", "## Research question", "", `> ${o.researchQuestion.text}`, ""];
  if (o.researchQuestion.postId) out.push(`Posted as https://x.com/sigalor/status/${o.researchQuestion.postId}.`, "");
  out.push("## Numbers", "", `- ${o.counts.posts} posts (${o.counts.graded} graded, ${o.counts.provisional} provisionally placed, ${o.counts.unclustered} unclustered)`);
  if (o.dateRange) out.push(`- from ${day(o.dateRange.first)} to ${day(o.dateRange.last)}`);
  out.push(`- relevance: ${fmtDist(o.relevance)}`, `- kinds: ${fmtDist(o.kinds)}`, `- languages: ${fmtDist(o.languages)}`, `- roles: ${fmtDist(o.roles)}`, "");
  out.push(`## Themes and topics (${o.counts.themes} themes, ${o.counts.topics} topics)`, "");
  for (const t of o.themes) { out.push(`- **${t.label}** (theme ${t.id}, ${t.size} posts)`); for (const tp of t.topics) out.push(`  - ${tp.label} (topic ${tp.id}, ${tp.size} posts${tp.meanGrade !== null ? `, mean grade ${tp.meanGrade}` : ""})`); }
  out.push("", "## Sub-questions", "");
  for (const q of o.questions.filter((q) => q.parentId !== null)) out.push(`- ${line(q.text)} (question ${q.id}, ${q.count} posts)`);
  return out.join("\n") + "\n";
}
const fmtDist = (d: Record<string, number>) => Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

export function mdTheme(theme: Theme, posts: Paged<Post>, c: Corpus, next: string | null): string {
  const intro = [`Topics: ${theme.topics.map((t) => `${t.label} (topic ${t.id}, ${t.size})`).join("; ")}`].join("\n");
  return mdPage(`Theme ${theme.id}: ${theme.label}`, posts, c, next, intro);
}
export function mdTopic(topic: Topic, theme: Theme | null, posts: Paged<Post>, c: Corpus, next: string | null): string {
  return mdPage(`Topic ${topic.id}: ${topic.label}`, posts, c, next, `Theme: ${theme ? `${theme.label} (theme ${theme.id})` : "none"}${topic.meanGrade !== null ? ` · mean grade ${topic.meanGrade}` : ""}`);
}
export function mdQuestion(q: Question, children: Question[], posts: Paged<Post>, c: Corpus, next: string | null): string {
  const intro = [`> ${line(q.text)}`, children.length ? `Sub-questions: ${children.map((x) => `${line(x.text)} (${x.id}, ${x.count})`).join("; ")}` : ""].filter(Boolean).join("\n\n");
  return mdPage(`Question ${q.id}`, posts, c, next, intro);
}
export function mdPostDetail(post: Post, neighbors: (Post & { distance: number })[], c: Corpus): string {
  const out = [mdPost(post, { heading: 1 }), "", snapshotLine(c)];
  if (neighbors.length) { out.push("", `## Nearest on the map (${neighbors.length})`, ""); for (const n of neighbors) out.push(mdPostLine(n, `distance ${n.distance}`)); }
  return out.join("\n") + "\n";
}
export function mdSearch(q: string, rows: (Post & { score: number })[], c: Corpus): string {
  const out = [`# Search: ${line(q)}`, "", snapshotLine(c), "", rows.length ? `${rows.length} results, best first (score = cosine similarity).` : "No results.", ""];
  for (const r of rows) out.push(mdPost(r, { extra: `score ${r.score.toFixed(3)}` }), "");
  return out.join("\n").trimEnd() + "\n";
}
/** Whole-corpus export grouped theme → topic → posts (unclustered last). */
export function mdExport(posts: Post[], c: Corpus): string {
  const out = [`# research.nalenz.org — ${posts.length} posts`, "", `> ${c.researchQuestion.text}`, "", snapshotLine(c), ""];
  const byTopic = new Map<number, Post[]>(); for (const p of posts) { const k = p.topic?.id ?? -1; byTopic.set(k, [...(byTopic.get(k) ?? []), p]); }
  for (const t of c.themes) {
    const tps = t.topics.filter((tp) => byTopic.has(tp.id)); if (!tps.length) continue;
    out.push(`## ${t.label}`, "");
    for (const tp of tps) { out.push(`### ${tp.label}`, ""); for (const p of byTopic.get(tp.id)!) out.push(mdPost(p, { heading: 4 }), ""); }
  }
  if (byTopic.has(-1)) { out.push("## Unclustered", ""); for (const p of byTopic.get(-1)!) out.push(mdPost(p, { heading: 4 }), ""); }
  return out.join("\n").trimEnd() + "\n";
}
