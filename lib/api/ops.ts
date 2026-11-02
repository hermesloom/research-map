import { type Corpus, type Post, type Theme, type Topic, type Question, filterPosts, sortPosts, paginate, nearest, distribution } from "./corpus";
import type { Page, PostFilter } from "./schemas";

/** The operations behind every REST route and MCP tool. Pure over a Corpus; routes and tools only format. */
export type Paged<T> = { data: T[]; page: { limit: number; offset: number; total: number; nextOffset: number | null } };

export function overview(c: Corpus) {
  const graded = c.posts.filter((p) => p.relevance.grade !== null); const times = c.posts.map((p) => p.createdAt).sort();
  return {
    researchQuestion: c.researchQuestion, snapshot: c.snapshot,
    counts: { posts: c.posts.length, graded: graded.length, provisional: c.posts.filter((p) => p.position.provisional).length, unclustered: c.posts.filter((p) => !p.topic).length, themes: c.themes.length, topics: c.topics.length },
    dateRange: times.length ? { first: times[0], last: times[times.length - 1] } : null,
    relevance: distribution(c.posts, (p) => p.relevance.label), kinds: distribution(c.posts, (p) => p.kind), languages: distribution(c.posts, (p) => p.language), roles: distribution(graded, (p) => p.relevance.role),
    themes: c.themes.map((t) => ({ id: t.id, label: t.label, size: t.size, topics: t.topics.map(({ id, label, size, meanGrade }) => ({ id, label, size, meanGrade })) })),
    questions: c.questions,
  };
}
export type Overview = ReturnType<typeof overview>;

export function listPosts(c: Corpus, f: Partial<PostFilter>, page: Page): Paged<Post> { return paginate(sortPosts(filterPosts(c.posts, f), f.sort), page); }

export function getPost(c: Corpus, id: string, k: number): { post: Post; neighbors: (Post & { distance: number })[] } | null {
  const post = c.byId.get(id); return post ? { post, neighbors: nearest(c, post, k) } : null;
}
export function getTheme(c: Corpus, id: number, page: Page): { theme: Theme; posts: Paged<Post> } | null {
  const theme = c.themes.find((t) => t.id === id); if (!theme) return null;
  return { theme, posts: paginate(sortPosts(filterPosts(c.posts, { theme: id }), "relevance"), page) };
}
export function getTopic(c: Corpus, id: number, page: Page): { topic: Topic; theme: Theme | null; posts: Paged<Post> } | null {
  const topic = c.topics.find((t) => t.id === id); if (!topic) return null;
  return { topic, theme: c.themes.find((t) => t.id === topic.themeId) ?? null, posts: paginate(sortPosts(filterPosts(c.posts, { topic: id }), "relevance"), page) };
}
export function getQuestion(c: Corpus, id: string, page: Page): { question: Question; children: Question[]; posts: Paged<Post> } | null {
  const question = c.questions.find((q) => q.id === id); if (!question) return null;
  return { question, children: c.questions.filter((q) => q.parentId === id), posts: paginate(sortPosts(filterPosts(c.posts, { question: id }), "relevance"), page) };
}
export function exportPosts(c: Corpus, f: Partial<PostFilter>, limit: number, offset = 0): Post[] { return sortPosts(filterPosts(c.posts, f), f.sort ?? "newest").slice(offset, offset + limit); }
