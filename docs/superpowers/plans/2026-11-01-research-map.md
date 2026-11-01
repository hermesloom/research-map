# research.nalenz.org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the open-source Next.js app + daily TypeScript pipeline + Python batch layout job that shows all @sigalor X posts on one stable, zoomable, multi-lens canvas at research.nalenz.org.

**Architecture:** A Next.js 16 app on Vercel Hobby serves a client-only canvas (Apple Embedding Atlas) that reads immutable JSON snapshots from Vercel Blob. A daily cron route runs an idempotent, stage-marked TypeScript pipeline (ingest → enrich → normalize → embed → place → grade → publish) against MongoDB Atlas. A Python job on GitHub Actions computes warm-started, Procrustes-aligned layouts, hierarchical labels with reuse, and the sub-question tree, writing versioned layouts back to Atlas.

**Tech Stack:** Node 24, pnpm, TypeScript (strict), Next.js 16.4 (App Router), React 19, `embedding-atlas` 0.26, `mongodb` 7, `openai` 7 (`responses.parse` + `openai/helpers/zod`), `zod` 4, `firecrawl` 4, `@vercel/blob` 2, `@vercel/config`, Vitest 5, Playwright 1.64; Python 3.12+ with `uv`, `umap-learn` 0.5.12, `hdbscan` 0.8.44, `scikit-learn`, `scipy`, `shapely`, `pymongo`, `openai`, `pytest`.

**Spec:** `docs/superpowers/specs/2026-11-01-research-map-design.md`

**Spec amendments made by this plan (recorded here, not silently):**
1. Search runs server-side (`GET /api/search?q=` → embed query → Atlas `$vectorSearch`) instead of in-browser over shipped vectors: 1,214 × 1,024 float32 ≈ 5 MB today, ≈ 10 MB at 2,500 posts, too much to ship eagerly.
2. Deletion reconciliation uses the owned-read timeline endpoint with `start_time` = 14 days ago (≈ $0.05/week) rather than per-id lookups (≈ $1/week).
3. Trails v1 are generated deterministically (items of grade ≥ 2 per sub-question ordered by date) with empty notes; LLM-written connective notes are deferred.
4. Thumbnails at zoom band z2 are rendered as Embedding Atlas image labels (`LabelContent = {image, width, height}`) rather than a custom sprite atlas; the batch job still writes per-item 512-px thumbnails to Blob.

## Global Constraints

- Domain: `research.nalenz.org`; repo `hermesloom/research-map`; license MIT (code only; post data never committed).
- X API: **never called from tests**; production calls only from the cron route and the weekly reconciliation; always `since_id`/`start_time` bounded; user-context OAuth 1.0a; no `author_id` / `referenced_tweets.id.author_id` expansions (billed as user reads). Owner id `1852658982608846848`.
- Embedding model pinned: `text-embedding-3-large`, `dimensions: 1024`, recorded in the manifest. Changing it = full re-embed + re-layout.
- Text/vision LLM default: `gpt-5.4-mini` (env-overridable; `gpt-5.4-nano` allowed for normalization). Temperature 0 where the API accepts it; every LLM output is validated with zod.
- Empty-input guard: no text and no OCR transcript ⇒ no normalization call, no vector, `needsContent: true`.
- Placement: nearest-neighbour snap + deterministic jitter (hash of xId), **never** coordinate averaging.
- Layouts are append-only versions; a new layout publishes only if `procrustesResidual ≤ 0.10` (configurable), else `status: 'draft'`.
- Re-layout trigger: provisional share > 8% (configurable) or manual.
- Vercel Hobby: cron once per day, function ≤ 300 s, function body ≤ 4.5 MB ⇒ canvas data comes from Blob, never from a route.
- Every daily run writes a `runs` document; every stage is idempotent and resumable via `items.stage`.
- Browser never queries MongoDB. Secrets only in Vercel env / GitHub Actions secrets / local `.env.local` (gitignored).
- Research-question post id `2115703316281778260` is flagged `isResearchQuestion: true` and excluded from grading and from search ranking.
- Unclustered posts (leaf = -1) are rendered like any other point; they are never hidden by clustering.

## Review Focus

Inputs the spec implies but which are easy to get wrong; each has a test pinned in the owning task:

1. **A post whose only URL is an `x.com/.../photo/1` link** must be treated as `media`, not `link`, and must not be sent to the host router as a web page (Task 4 test `classifies photo permalink as media`).
2. **A Wikipedia URL with percent-encoded or `#fragment` titles** (e.g. `Christian_Wolff_%28Aufkl%C3%A4rer%29`, `Robert_Kegan#The_Evolving_Self`) must resolve to the right REST summary title (Task 6 test `wikipedia title extraction handles encoding and fragments`).
3. **A self-reply whose parent is not in the database** (parent deleted or outside the corpus) must still normalize, using its own text only (Task 8 test `normalize self-reply without parent`).
4. **A daily run when no layout has been published yet** (fresh database after bootstrap, before the first batch run) must leave items at stage `embedded`, log the reason, and still exit 200 (Task 13 test `run without published layout skips placement`).
5. **A published layout containing an item id that no longer exists in `items`** (tombstoned) must publish without that point and without crashing the snapshot builder (Task 12 test `snapshot drops tombstoned items`).

---

## File structure

```
research-map/
  package.json  pnpm-lock.yaml  tsconfig.json  next.config.ts  vercel.ts  vitest.config.ts  playwright.config.ts
  .env.example  .gitignore  LICENSE  README.md
  app/
    layout.tsx  globals.css  page.tsx                     # page.tsx renders <Canvas/> via next/dynamic ssr:false
    canvas/Canvas.tsx                                     # EmbeddingView host, lens tweening, zoom band logic
    canvas/useSnapshot.ts                                 # manifest → points → labels → meta (lazy)
    canvas/lenses.ts                                      # terrain | questionRadial | timeStrata coordinate functions
    canvas/colors.ts                                      # leaf palette + grade alpha → categoryColors
    canvas/CardOverlay.ts                                 # customOverlay class: DOM cards (z3), rings, arrival trail
    canvas/TopBar.tsx  canvas/Inspector.tsx  canvas/Filters.tsx  canvas/urlState.ts  canvas/export.ts
    api/manifest/route.ts  api/posts/route.ts  api/status/route.ts  api/search/route.ts
    api/cron/ingest/route.ts
    api/owner/login/route.ts  api/owner/override/route.ts
  lib/
    env.ts  types.ts  db.ts  hash.ts  blob.ts
    x/oauth1.ts  x/client.ts  x/parse.ts
    enrich/router.ts  enrich/types.ts  enrich/wikipedia.ts  enrich/youtube.ts  enrich/arxiv.ts
    enrich/openalex.ts  enrich/github.ts  enrich/firecrawl.ts  enrich/wayback.ts  enrich/ladder.ts  enrich/vision.ts
    llm/openai.ts  llm/normalize.ts  llm/embed.ts  llm/grade.ts
    place.ts  snapshot.ts  publish.ts  overrides.ts
    pipeline/stages.ts  pipeline/run.ts  pipeline/reconcile.ts
  scripts/
    bootstrap.ts  seed-questions.ts  make-fixture.ts  trigger-batch.ts
  data/
    anchors.json  label-overrides.json
  batch/
    pyproject.toml  README.md
    research_map_batch/__init__.py  db.py  layout.py  cluster.py  label.py  questions.py  hulls.py  thumbs.py  write.py  main.py
    tests/test_layout.py  tests/test_cluster.py  tests/test_label.py  tests/test_write.py
  tests/
    fixtures/timeline-sample.json  fixtures/enrich/*.json  fixtures/x-oauth-vector.json
    unit/*.test.ts  integration/*.test.ts  e2e/canvas.spec.ts
  .github/workflows/batch.yml  .github/workflows/ci.yml
```

---

## Phase 0 — Scaffold

### Task 1: Repository scaffold, tooling, GitHub repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`, `LICENSE`, `README.md`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/env.ts`, `tests/unit/env.test.ts`
- Existing: `docs/superpowers/specs/...` (already committed in `/home/weaver/research-map`)

**Interfaces:**
- Produces: `lib/env.ts` exporting `env` (validated process env) and `optionalEnv(name)`.

- [ ] **Step 1: Scaffold Next.js into the existing directory**

```bash
cd /home/weaver/research-map
pnpm dlx create-next-app@16.4.3 . --ts --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-pnpm --skip-install --yes
# create-next-app refuses a non-empty dir only if it contains conflicting files; docs/ and .git are fine.
pnpm add mongodb@7 openai@7 zod@4 firecrawl@4 @vercel/blob@2 @vercel/config embedding-atlas@0.26.0
pnpm add -D vitest@5 @vitest/coverage-v8 tsx@4 @playwright/test@1.64.1 @types/node
```

- [ ] **Step 2: Write `.gitignore`, `.env.example`, `LICENSE`, `README.md`**

`.gitignore` (append to the generated one):
```
.env*
!.env.example
/data/snapshots/
/batch/.venv/
/batch/**/__pycache__/
/playwright-report/
/test-results/
```

`.env.example`:
```
MONGODB_URI=mongodb+srv://USER:PASS@host/?retryWrites=true&w=majority
MONGODB_DB=research_map
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5.4-mini
OPENAI_VISION_MODEL=gpt-5.4-mini
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMS=1024
X_USER_ID=1852658982608846848
X_CONSUMER_KEY=
X_CONSUMER_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_BEARER_TOKEN=
FIRECRAWL_API_KEY=
CRON_SECRET=
OWNER_SECRET=
GITHUB_DISPATCH_TOKEN=
GITHUB_REPO=hermesloom/research-map
BLOB_READ_WRITE_TOKEN=
RESEARCH_QUESTION_POST_ID=2115703316281778260
RELAYOUT_PROVISIONAL_THRESHOLD=0.08
```

`LICENSE`: MIT, copyright 2026 Julian Nalenz / hermesloom.

`README.md`: title, one paragraph of purpose, the research question, "How it works" (three runtimes), "Development" (`pnpm i`, `cp .env.example .env.local`, `pnpm dev`, `pnpm test`), "Batch job" (`cd batch && uv sync && uv run research-map-batch --help`), "Data notice: post content belongs to the author; snapshots are not in git."

- [ ] **Step 3: Write the failing env test**

`tests/unit/env.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("env", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env = { ...saved }; });
  afterEach(() => { process.env = saved; });

  it("parses required vars and applies defaults", async () => {
    process.env.MONGODB_URI = "mongodb://x";
    process.env.OPENAI_API_KEY = "k";
    delete process.env.EMBEDDING_DIMS;
    const { loadEnv } = await import("@/lib/env");
    const env = loadEnv();
    expect(env.EMBEDDING_DIMS).toBe(1024);
    expect(env.MONGODB_DB).toBe("research_map");
    expect(env.OPENAI_TEXT_MODEL).toBe("gpt-5.4-mini");
  });

  it("throws a readable error listing missing vars", async () => {
    delete process.env.MONGODB_URI;
    delete process.env.OPENAI_API_KEY;
    const { loadEnv } = await import("@/lib/env");
    expect(() => loadEnv()).toThrow(/MONGODB_URI/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: FAIL with "Cannot find module '@/lib/env'"

- [ ] **Step 5: Write `vitest.config.ts` and `lib/env.ts`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30000 },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

`lib/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("research_map"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_VISION_MODEL: z.string().default("gpt-5.4-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1024),
  X_USER_ID: z.string().default("1852658982608846848"),
  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  OWNER_SECRET: z.string().optional(),
  GITHUB_DISPATCH_TOKEN: z.string().optional(),
  GITHUB_REPO: z.string().default("hermesloom/research-map"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  RESEARCH_QUESTION_POST_ID: z.string().default("2115703316281778260"),
  RELAYOUT_PROVISIONAL_THRESHOLD: z.coerce.number().default(0.08),
});
export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function loadEnv(): Env {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    const missing = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  cached = r.data;
  return r.data;
}
export function env(): Env { return cached ?? loadEnv(); }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Minimal app shell**

`app/page.tsx`:
```tsx
import dynamic from "next/dynamic";
const Canvas = dynamic(() => import("./canvas/Canvas"), { ssr: false, loading: () => <p style={{ padding: 16 }}>Loading map…</p> });
export default function Page() { return <Canvas />; }
```
`app/canvas/Canvas.tsx` (placeholder until Task 18, must compile):
```tsx
"use client";
export default function Canvas() { return <div id="canvas-root">canvas</div>; }
```
`app/layout.tsx`: html/body with `<title>research.nalenz.org</title>`, viewport meta, import `./globals.css` (body margin 0, height 100dvh, font-family system-ui, background #0b0d10, color #e6e6e6).

Add to `package.json` scripts: `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"typecheck": "tsc --noEmit"`, `"bootstrap": "tsx scripts/bootstrap.ts"`, `"seed:questions": "tsx scripts/seed-questions.ts"`.

Run: `pnpm typecheck && pnpm build`
Expected: both succeed.

- [ ] **Step 8: Create the GitHub repo and push**

```bash
cd /home/weaver/research-map
git add -A && git commit -m "chore: scaffold Next.js app, tooling, env loader"
gh repo create hermesloom/research-map --public --source=. --remote=origin --description "A living map of @sigalor's research posts around one question" --push
```
Expected: repo exists at https://github.com/hermesloom/research-map with `main` pushed.

---

## Phase 1 — Core library and daily pipeline (TypeScript)

### Task 2: Domain types and zod schemas

**Files:**
- Create: `lib/types.ts`, `tests/unit/types.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
export type Kind = "text" | "link" | "media" | "selfReply" | "quote" | "replyToOther" | "retweet";
export type Stage = "ingested" | "enriched" | "normalized" | "embedded" | "placed" | "graded";
export interface ItemUrl { url: string; expandedUrl: string; unwoundUrl?: string; title?: string; description?: string; domain: string; isMedia: boolean; }
export interface ItemMedia { mediaKey: string; type: "photo" | "video" | "animated_gif"; url?: string; previewUrl?: string; altText?: string; }
export interface Item { xId: string; text: string; createdAt: Date; kind: Kind; urls: ItemUrl[]; media: ItemMedia[]; parentId?: string; quotedId?: string; lang?: string;
  publicMetrics?: Record<string, number>; isResearchQuestion: boolean; stage: Stage; stageError?: string; deletedAt?: Date; fetchedAt: Date; }
export interface Enrichment { xId: string; source: EnrichSource; title?: string; excerpt?: string; ogImage?: string; transcript?: string; imageDescription?: string;
  thumbUrl?: string; originalMediaUrl?: string; thin: boolean; needsContent: boolean; normalized?: Normalized; fetchedAt: Date; }
export type EnrichSource = "wikipedia" | "oembed" | "arxiv" | "openalex" | "github" | "firecrawl" | "wayback" | "thin" | "none";
export const NormalizedSchema = z.object({ title: z.string().min(1).max(120), summaryEn: z.string().min(1).max(400), gist: z.string().min(1).max(600),
  tagsEn: z.array(z.string().min(1).max(40)).max(8), language: z.enum(["en","de","other"]), entities: z.array(z.string()).max(12),
  contentKind: z.enum(["thought","link","paper","video","code","image","music","humor","other"]) });
export type Normalized = z.infer<typeof NormalizedSchema>;
export interface VectorDoc { xId: string; embedding: number[]; model: string; dims: number; inputHash: string; }
export const RoleSchema = z.enum(["evidence","example","counterexample","tool","inspiration","extension","tangent","unrelated"]);
export const GradeSchema = z.object({ grade: z.number().int().min(0).max(3), role: RoleSchema, rationale: z.string().min(1).max(300), subQuestionIds: z.array(z.string()).max(2) });
export interface Relation { xId: string; questionId: string; role: Role; grade: number; rationale: string; cosine: number; modelVersion: string; disagreement: boolean; }
export interface Question { _id: string; text: string; parentId: string | null; embedding?: number[]; validFrom: Date; validTo: Date | null; origin: "seed" | "induced" | "curated"; }
export interface LayoutPoint { xId: string; x: number; y: number; clusterId: number; provisional: boolean; }
export interface LayoutLabel { level: number; text: string; x: number; y: number; priority: number; clusterId: number; themeId?: number; }
export interface Layout { version: number; createdAt: Date; method: string; status: "draft" | "published"; points: LayoutPoint[]; labels: LayoutLabel[];
  themes: { id: number; label: string; clusterIds: number[] }[]; clusters: { id: number; label: string; themeId: number; size: number; x: number; y: number }[];
  hulls: { clusterId: number; polygon: [number, number][] }[]; procrustesResidual: number | null; }
export interface Manifest { _id: "current"; layoutVersion: number; pointsUrl: string; metaUrl: string; labelsUrl: string; generatedAt: Date; count: number; embeddingModel: string; }
export interface RunDoc { startedAt: Date; finishedAt?: Date; kind: "daily" | "bootstrap" | "reconcile"; counts: Record<string, number>; errors: string[]; notes: string[]; ok: boolean; }
export interface Override { _id?: unknown; type: "pin" | "renameLabel" | "moveLeaf" | "retireQuestion" | "trailEdit"; xId?: string; clusterId?: number; questionId?: string;
  payload: Record<string, unknown>; createdAt: Date; }
```

- [ ] **Step 1: Write the failing test**

`tests/unit/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NormalizedSchema, GradeSchema } from "@/lib/types";

describe("schemas", () => {
  it("accepts a valid normalization", () => {
    const r = NormalizedSchema.safeParse({ title: "XTDB", summaryEn: "A bitemporal database.", gist: "XTDB", tagsEn: ["database"], language: "en", entities: ["XTDB"], contentKind: "link" });
    expect(r.success).toBe(true);
  });
  it("rejects grade outside 0..3 and unknown role", () => {
    expect(GradeSchema.safeParse({ grade: 4, role: "evidence", rationale: "x", subQuestionIds: [] }).success).toBe(false);
    expect(GradeSchema.safeParse({ grade: 2, role: "vibes", rationale: "x", subQuestionIds: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run tests/unit/types.test.ts` → FAIL (module not found)
- [ ] **Step 3: Write `lib/types.ts`** exactly as in Interfaces above (with `import { z } from "zod"` and `export type Role = z.infer<typeof RoleSchema>`).
- [ ] **Step 4: Run test to verify it passes** — PASS
- [ ] **Step 5: Commit** — `git add lib/types.ts tests/unit/types.test.ts && git commit -m "feat: domain types and zod schemas"`

### Task 3: MongoDB client, collections, indexes

**Files:**
- Create: `lib/db.ts`, `tests/integration/db.test.ts`

**Interfaces:**
- Produces: `getDb(): Promise<Db>`, `collections(db)` returning typed handles `{ items, enrichment, vectors, facets, assignments, questions, relations, layouts, lenses, trails, overrides, runs, manifest }`, `ensureIndexes(db)`, `ensureVectorIndex(db, dims)`, `closeDb()`.
- Integration tests run only when `MONGODB_URI_TEST` is set (they use database `research_map_test` and drop it afterwards); otherwise they are skipped with a message.

- [ ] **Step 1: Write the failing test**

`tests/integration/db.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
const uri = process.env.MONGODB_URI_TEST;
const d = uri ? describe : describe.skip;

d("db", () => {
  let mod: typeof import("@/lib/db");
  beforeAll(async () => {
    process.env.MONGODB_URI = uri!; process.env.MONGODB_DB = "research_map_test"; process.env.OPENAI_API_KEY = "x";
    mod = await import("@/lib/db");
  });
  afterAll(async () => { const db = await mod.getDb(); await db.dropDatabase(); await mod.closeDb(); });

  it("creates unique xId indexes and upserts idempotently", async () => {
    const db = await mod.getDb(); await mod.ensureIndexes(db);
    const { items } = mod.collections(db);
    const doc = { xId: "1", text: "a", createdAt: new Date(), kind: "text", urls: [], media: [], isResearchQuestion: false, stage: "ingested", fetchedAt: new Date() } as const;
    await items.updateOne({ xId: "1" }, { $setOnInsert: doc }, { upsert: true });
    await items.updateOne({ xId: "1" }, { $setOnInsert: doc }, { upsert: true });
    expect(await items.countDocuments({ xId: "1" })).toBe(1);
    const idx = await items.indexes();
    expect(idx.some((i) => i.unique && i.key.xId === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `MONGODB_URI_TEST=... pnpm vitest run tests/integration/db.test.ts` → FAIL (module not found). Without the env var: skipped.

- [ ] **Step 3: Write `lib/db.ts`**

```ts
import { MongoClient, type Db, type Collection } from "mongodb";
import { env } from "./env";
import type { Item, Enrichment, VectorDoc, Question, Relation, Layout, Manifest, RunDoc, Override } from "./types";

let client: MongoClient | null = null;
export async function getDb(): Promise<Db> {
  if (!client) { client = new MongoClient(env().MONGODB_URI, { maxPoolSize: 5 }); await client.connect(); }
  return client.db(env().MONGODB_DB);
}
export async function closeDb() { await client?.close(); client = null; }

export function collections(db: Db) {
  return {
    items: db.collection<Item>("items"),
    enrichment: db.collection<Enrichment>("enrichment"),
    vectors: db.collection<VectorDoc>("vectors"),
    facets: db.collection("facets"),
    assignments: db.collection("assignments"),
    questions: db.collection<Question>("questions"),
    relations: db.collection<Relation>("relations"),
    layouts: db.collection<Layout>("layouts"),
    lenses: db.collection("lenses"),
    trails: db.collection("trails"),
    overrides: db.collection<Override>("overrides"),
    runs: db.collection<RunDoc>("runs"),
    manifest: db.collection<Manifest>("manifest"),
  };
}
export type Collections = ReturnType<typeof collections>;

export async function ensureIndexes(db: Db) {
  const c = collections(db);
  await c.items.createIndex({ xId: 1 }, { unique: true });
  await c.items.createIndex({ stage: 1, createdAt: 1 });
  await c.items.createIndex({ createdAt: -1 });
  await c.enrichment.createIndex({ xId: 1 }, { unique: true });
  await c.vectors.createIndex({ xId: 1 }, { unique: true });
  await c.relations.createIndex({ xId: 1, questionId: 1 }, { unique: true });
  await c.layouts.createIndex({ version: -1 }, { unique: true });
  await c.layouts.createIndex({ status: 1, version: -1 });
  await c.runs.createIndex({ startedAt: -1 });
  await c.overrides.createIndex({ type: 1, xId: 1, clusterId: 1 });
}

/** Atlas Vector Search index on vectors.embedding. No-op if it exists. Requires Atlas (not local mongod). */
export async function ensureVectorIndex(db: Db, dims: number) {
  const col = db.collection("vectors");
  const existing = await col.listSearchIndexes().toArray().catch(() => []);
  if (existing.some((i) => i.name === "embedding_idx")) return;
  await col.createSearchIndex({
    name: "embedding_idx", type: "vectorSearch",
    definition: { fields: [{ type: "vector", path: "embedding", numDimensions: dims, similarity: "cosine" }] },
  });
}
```

- [ ] **Step 4: Run** — PASS (or skipped without env)
- [ ] **Step 5: Commit** — `git commit -am "feat: mongodb client, collections, indexes"`

### Task 4: Parse X API payloads into items (+ test fixture)

**Files:**
- Create: `lib/x/parse.ts`, `scripts/make-fixture.ts`, `tests/fixtures/timeline-sample.json`, `tests/unit/parse.test.ts`

**Interfaces:**
- Consumes: `Item`, `ItemUrl`, `ItemMedia` from Task 2.
- Produces: `parseTimeline(payload: XTimelinePayload, ownerId: string, researchQuestionPostId: string): Item[]` and `classifyKind(tweet, ownerId): Kind`, plus `domainOf(url: string): string`. `XTimelinePayload = { data?: XTweet[]; includes?: { media?: XMedia[]; tweets?: XTweet[] } }` where `XTweet` mirrors the v2 fields requested (`id, text, created_at, lang, entities?.urls[], attachments?.media_keys, referenced_tweets?, in_reply_to_user_id?, note_tweet?.text, public_metrics`).

- [ ] **Step 1: Build the fixture from the real export (one-time, no API call)**

`scripts/make-fixture.ts`:
```ts
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync(process.argv[2] ?? `${process.env.HOME}/x-nalenz-data/timeline-2026-11-01.json`, "utf8"));
const wantIds = new Set<string>();
const pick = (pred: (t: any) => boolean, n: number) => src.tweets.filter(pred).slice(0, n).forEach((t: any) => wantIds.add(t.id));
pick((t) => !t.referenced_tweets && !t.attachments && !t.entities?.urls, 4);                 // text
pick((t) => !t.referenced_tweets && t.entities?.urls?.some((u: any) => u.title), 4);          // titled link
pick((t) => !t.referenced_tweets && t.entities?.urls?.length && !t.entities.urls.some((u: any) => u.title) && !t.attachments, 3); // untitled link
pick((t) => t.attachments?.media_keys && !t.referenced_tweets, 3);                             // media
pick((t) => t.referenced_tweets?.[0]?.type === "replied_to" && t.in_reply_to_user_id === "1852658982608846848", 3); // self reply
pick((t) => t.referenced_tweets?.[0]?.type === "replied_to" && t.in_reply_to_user_id !== "1852658982608846848", 3); // reply to other
pick((t) => t.referenced_tweets?.[0]?.type === "retweeted", 2);
pick((t) => t.referenced_tweets?.[0]?.type === "quoted", 1);
pick((t) => t.note_tweet, 2);
wantIds.add("2115703316281778260"); // the research question post
const data = src.tweets.filter((t: any) => wantIds.has(t.id));
const keys = new Set(data.flatMap((t: any) => t.attachments?.media_keys ?? []));
const media = src.includes.media.filter((m: any) => keys.has(m.media_key));
fs.writeFileSync("tests/fixtures/timeline-sample.json", JSON.stringify({ data, includes: { media } }, null, 1));
console.log(data.length, "tweets", media.length, "media");
```
Run: `pnpm tsx scripts/make-fixture.ts` → expected ≈ 26 tweets. Inspect the file; confirm it contains one tweet whose only URL is an `x.com/sigalor/status/.../photo/1` link.

- [ ] **Step 2: Write the failing tests**

`tests/unit/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseTimeline, classifyKind, domainOf } from "@/lib/x/parse";
const payload = JSON.parse(fs.readFileSync("tests/fixtures/timeline-sample.json", "utf8"));
const OWNER = "1852658982608846848";
const items = parseTimeline(payload, OWNER, "2115703316281778260");

describe("parseTimeline", () => {
  it("keeps every tweet exactly once and sorts by createdAt ascending", () => {
    expect(items.length).toBe(payload.data.length);
    expect(new Set(items.map((i) => i.xId)).size).toBe(items.length);
    for (let i = 1; i < items.length; i++) expect(items[i].createdAt >= items[i - 1].createdAt).toBe(true);
  });
  it("classifies kinds", () => {
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["text", "link", "media", "selfReply", "replyToOther", "retweet"]) expect(kinds.has(k as any)).toBe(true);
  });
  it("classifies photo permalink as media, not link", () => {
    const photo = items.find((i) => i.urls.some((u) => /x\.com\/\w+\/status\/\d+\/photo\/1/.test(u.expandedUrl)));
    expect(photo).toBeDefined();
    expect(photo!.kind).toBe("media");
    expect(photo!.urls.every((u) => u.isMedia)).toBe(true);
  });
  it("uses note_tweet text when present", () => {
    const long = items.find((i) => i.text.length > 280);
    expect(long).toBeDefined();
  });
  it("expands t.co to unwound/expanded URL and extracts domain", () => {
    const link = items.find((i) => i.kind === "link")!;
    expect(link.urls[0].expandedUrl.startsWith("https://t.co/")).toBe(false);
    expect(link.urls[0].domain).not.toMatch(/^www\./);
  });
  it("flags the research question post", () => {
    expect(items.find((i) => i.xId === "2115703316281778260")!.isResearchQuestion).toBe(true);
  });
  it("sets parentId for replies and quotedId for quotes", () => {
    expect(items.find((i) => i.kind === "selfReply")!.parentId).toMatch(/^\d+$/);
  });
  it("attaches media objects from includes", () => {
    const m = items.find((i) => i.kind === "media")!;
    expect(m.media.length).toBeGreaterThan(0);
    expect(m.media[0].mediaKey).toBeTruthy();
  });
  it("domainOf strips www and lowercases", () => {
    expect(domainOf("https://WWW.Example.com/a?b")).toBe("example.com");
    expect(domainOf("not a url")).toBe("");
  });
});
```

- [ ] **Step 3: Run** → FAIL (module not found)

- [ ] **Step 4: Write `lib/x/parse.ts`**

```ts
import type { Item, ItemMedia, ItemUrl, Kind } from "../types";

export interface XUrl { url: string; expanded_url?: string; unwound_url?: string; title?: string; description?: string; media_key?: string; }
export interface XTweet { id: string; text: string; created_at: string; lang?: string; entities?: { urls?: XUrl[] }; attachments?: { media_keys?: string[] };
  referenced_tweets?: { type: "replied_to" | "quoted" | "retweeted"; id: string }[]; in_reply_to_user_id?: string; note_tweet?: { text: string }; public_metrics?: Record<string, number>; }
export interface XMedia { media_key: string; type: "photo" | "video" | "animated_gif"; url?: string; preview_image_url?: string; alt_text?: string; }
export interface XTimelinePayload { data?: XTweet[]; includes?: { media?: XMedia[]; tweets?: XTweet[] }; meta?: { next_token?: string; newest_id?: string; result_count?: number } }

export function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
const PHOTO_RE = /^https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\/(photo|video)\/\d+/;

export function classifyKind(t: XTweet, ownerId: string): Kind {
  const ref = t.referenced_tweets?.[0];
  if (ref?.type === "retweeted") return "retweet";
  if (ref?.type === "replied_to") return t.in_reply_to_user_id === ownerId ? "selfReply" : "replyToOther";
  if (ref?.type === "quoted") return "quote";
  const urls = t.entities?.urls ?? [];
  const external = urls.filter((u) => !PHOTO_RE.test(u.expanded_url ?? "") && !u.media_key);
  if (t.attachments?.media_keys?.length || (urls.length && external.length === 0)) return "media";
  if (external.length) return "link";
  return "text";
}

function toItemUrls(t: XTweet): ItemUrl[] {
  return (t.entities?.urls ?? []).map((u) => {
    const expanded = u.unwound_url || u.expanded_url || u.url;
    const isMedia = PHOTO_RE.test(u.expanded_url ?? "") || !!u.media_key;
    return { url: u.url, expandedUrl: expanded, unwoundUrl: u.unwound_url, title: u.title, description: u.description, domain: domainOf(expanded), isMedia };
  });
}

export function parseTimeline(payload: XTimelinePayload, ownerId: string, researchQuestionPostId: string): Item[] {
  const mediaByKey = new Map((payload.includes?.media ?? []).map((m) => [m.media_key, m]));
  const now = new Date();
  const items = (payload.data ?? []).map<Item>((t) => {
    const kind = classifyKind(t, ownerId);
    const ref = t.referenced_tweets?.[0];
    const media: ItemMedia[] = (t.attachments?.media_keys ?? []).map((k) => {
      const m = mediaByKey.get(k);
      return { mediaKey: k, type: m?.type ?? "photo", url: m?.url, previewUrl: m?.preview_image_url, altText: m?.alt_text };
    });
    return {
      xId: t.id, text: t.note_tweet?.text ?? t.text, createdAt: new Date(t.created_at), kind, urls: toItemUrls(t), media,
      parentId: ref?.type === "replied_to" ? ref.id : undefined, quotedId: ref?.type === "quoted" ? ref.id : undefined,
      lang: t.lang, publicMetrics: t.public_metrics, isResearchQuestion: t.id === researchQuestionPostId, stage: "ingested", fetchedAt: now,
    };
  });
  return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
```

- [ ] **Step 5: Run** → PASS (9 tests). If `classifies kinds` fails because the fixture lacks a kind, re-run `make-fixture.ts` with a larger `n` for that predicate.
- [ ] **Step 6: Commit** — `git add lib/x/parse.ts scripts/make-fixture.ts tests/fixtures/timeline-sample.json tests/unit/parse.test.ts && git commit -m "feat: parse X timeline payloads into items"`

### Task 5: X client with OAuth 1.0a user context and since_id fetch

**Files:**
- Create: `lib/x/oauth1.ts`, `lib/x/client.ts`, `tests/fixtures/x-oauth-vector.json`, `tests/unit/oauth1.test.ts`, `tests/unit/xclient.test.ts`

**Interfaces:**
- Produces: `oauth1Header({ method, url, query, consumerKey, consumerSecret, token, tokenSecret, nonce?, timestamp? }): string` and `percentEncode(s)`; `fetchNewPosts({ sinceId?, startTime?, maxPages = 5, fetchImpl = fetch }): Promise<{ payload: XTimelinePayload; requests: number }>` which merges pages into one payload. Uses user-context OAuth 1.0a when `X_ACCESS_TOKEN` is set, else `X_BEARER_TOKEN`.
- Billing guard: `fetchNewPosts` throws if neither `sinceId` nor `startTime` is given (prevents accidental full sweeps).

- [ ] **Step 1: Write the signature test vector** — `tests/fixtures/x-oauth-vector.json` with the worked example from X's "Creating a signature" documentation page (copy the values from https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature; the widely published example is: method POST, url `https://api.twitter.com/1.1/statuses/update.json`, params `include_entities=true`, `status=Hello Ladies + Gentlemen, a signed OAuth request!`, consumer key `xvz1evFS4wEEPTGEFPHBog`, consumer secret `kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw`, token `370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb`, token secret `LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE`, nonce `kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg`, timestamp `1318622958`, expected signature `hCtSmYh+iHYCEqBWrE7C7hYmtUk=`). If the page's values differ, the page wins.

- [ ] **Step 2: Write the failing tests**

`tests/unit/oauth1.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { oauth1Header, percentEncode, signatureBaseString } from "@/lib/x/oauth1";
const v = JSON.parse(fs.readFileSync("tests/fixtures/x-oauth-vector.json", "utf8"));

describe("oauth1", () => {
  it("percent-encodes per RFC 3986 (space → %20, * → %2A, ~ kept)", () => {
    expect(percentEncode("Ladies + Gentlemen")).toBe("Ladies%20%2B%20Gentlemen");
    expect(percentEncode("a*b~c")).toBe("a%2Ab~c");
  });
  it("reproduces the documented signature", () => {
    const h = oauth1Header({ method: v.method, url: v.url, query: v.params, consumerKey: v.consumerKey, consumerSecret: v.consumerSecret,
      token: v.token, tokenSecret: v.tokenSecret, nonce: v.nonce, timestamp: v.timestamp });
    expect(h).toContain(`oauth_signature="${percentEncode(v.expectedSignature)}"`);
    expect(h.startsWith("OAuth ")).toBe(true);
  });
  it("base string has exactly two ampersands", () => {
    const b = signatureBaseString("GET", "https://api.x.com/2/users/1/tweets", { since_id: "5", oauth_nonce: "n" });
    expect(b.split("&").length).toBe(3);
  });
});
```

`tests/unit/xclient.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { fetchNewPosts } from "@/lib/x/client";

beforeEach(() => {
  process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k";
  process.env.X_CONSUMER_KEY = "ck"; process.env.X_CONSUMER_SECRET = "cs"; process.env.X_ACCESS_TOKEN = "t"; process.env.X_ACCESS_TOKEN_SECRET = "ts";
});

describe("fetchNewPosts", () => {
  it("refuses to run without since_id or start_time", async () => {
    await expect(fetchNewPosts({ fetchImpl: async () => new Response("{}") } as any)).rejects.toThrow(/since_id|start_time/);
  });
  it("requests the owner timeline with the exact field set and no author expansion, and paginates", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers.Authorization).toMatch(/^OAuth /);
      if (calls.length === 1) return new Response(JSON.stringify({ data: [{ id: "2", text: "b", created_at: "2026-01-02T00:00:00Z" }], meta: { next_token: "N" } }));
      return new Response(JSON.stringify({ data: [{ id: "1", text: "a", created_at: "2026-01-01T00:00:00Z" }], meta: {} }));
    };
    const r = await fetchNewPosts({ sinceId: "0", fetchImpl: fetchImpl as any });
    expect(r.requests).toBe(2);
    expect(r.payload.data!.map((t) => t.id)).toEqual(["2", "1"]);
    const u = new URL(calls[0]);
    expect(u.pathname).toBe("/2/users/1852658982608846848/tweets");
    expect(u.searchParams.get("since_id")).toBe("0");
    expect(u.searchParams.get("expansions")).toBe("attachments.media_keys");
    expect(u.searchParams.get("tweet.fields")).toContain("note_tweet");
    expect(u.searchParams.get("expansions")).not.toContain("author_id");
    expect(new URL(calls[1]).searchParams.get("pagination_token")).toBe("N");
  });
  it("returns an empty payload on 0 results without a second request", async () => {
    let n = 0;
    const r = await fetchNewPosts({ sinceId: "9", fetchImpl: (async () => { n++; return new Response(JSON.stringify({ meta: { result_count: 0 } })); }) as any });
    expect(n).toBe(1); expect(r.payload.data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** → FAIL

- [ ] **Step 4: Write `lib/x/oauth1.ts`**

```ts
import { createHmac, randomBytes } from "node:crypto";

export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
export function signatureBaseString(method: string, baseUrl: string, params: Record<string, string>): string {
  const pairs = Object.entries(params).map(([k, v]) => [percentEncode(k), percentEncode(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  return `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
}
export interface OAuth1Input { method: string; url: string; query: Record<string, string>; consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; nonce?: string; timestamp?: string; }
export function oauth1Header(i: OAuth1Input): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: i.consumerKey, oauth_nonce: i.nonce ?? randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: i.timestamp ?? String(Math.floor(Date.now() / 1000)), oauth_token: i.token, oauth_version: "1.0",
  };
  const base = signatureBaseString(i.method, i.url, { ...i.query, ...oauth });
  const key = `${percentEncode(i.consumerSecret)}&${percentEncode(i.tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`).join(", ");
}
```

- [ ] **Step 5: Write `lib/x/client.ts`**

```ts
import { env } from "../env";
import { oauth1Header } from "./oauth1";
import type { XTimelinePayload } from "./parse";

const TWEET_FIELDS = "created_at,entities,attachments,referenced_tweets,in_reply_to_user_id,lang,public_metrics,note_tweet";
const MEDIA_FIELDS = "url,preview_image_url,type,alt_text";

export interface FetchOpts { sinceId?: string; startTime?: string; maxPages?: number; fetchImpl?: typeof fetch; }

export async function fetchNewPosts(opts: FetchOpts): Promise<{ payload: XTimelinePayload; requests: number }> {
  if (!opts.sinceId && !opts.startTime) throw new Error("fetchNewPosts requires since_id or start_time (billing guard)");
  const e = env(); const f = opts.fetchImpl ?? fetch; const maxPages = opts.maxPages ?? 5;
  const base = `https://api.x.com/2/users/${e.X_USER_ID}/tweets`;
  const merged: XTimelinePayload = { data: [], includes: { media: [] } };
  let token: string | undefined; let requests = 0;
  do {
    const q: Record<string, string> = { max_results: "100", "tweet.fields": TWEET_FIELDS, expansions: "attachments.media_keys", "media.fields": MEDIA_FIELDS };
    if (opts.sinceId) q.since_id = opts.sinceId;
    if (opts.startTime) q.start_time = opts.startTime;
    if (token) q.pagination_token = token;
    const url = `${base}?${new URLSearchParams(q)}`;
    const headers: Record<string, string> = {};
    if (e.X_ACCESS_TOKEN && e.X_ACCESS_TOKEN_SECRET && e.X_CONSUMER_KEY && e.X_CONSUMER_SECRET) {
      headers.Authorization = oauth1Header({ method: "GET", url: base, query: q, consumerKey: e.X_CONSUMER_KEY, consumerSecret: e.X_CONSUMER_SECRET, token: e.X_ACCESS_TOKEN, tokenSecret: e.X_ACCESS_TOKEN_SECRET });
    } else if (e.X_BEARER_TOKEN) headers.Authorization = `Bearer ${e.X_BEARER_TOKEN}`;
    else throw new Error("No X credentials configured");
    const res = await f(url, { headers }); requests++;
    if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = (await res.json()) as XTimelinePayload;
    merged.data!.push(...(page.data ?? []));
    merged.includes!.media!.push(...(page.includes?.media ?? []));
    token = page.meta?.next_token;
  } while (token && requests < maxPages);
  return { payload: merged, requests };
}
```

- [ ] **Step 6: Run both test files** → PASS. If the signature vector fails, re-verify the fixture values against the X docs page before touching the algorithm; the algorithm above is the documented one.
- [ ] **Step 7: Commit** — `git add lib/x tests/unit/oauth1.test.ts tests/unit/xclient.test.ts tests/fixtures/x-oauth-vector.json && git commit -m "feat: X client with OAuth 1.0a user context and billing guard"`

### Task 6: Enrichment — host router and free adapters (Wikipedia, YouTube, GitHub)

**Files:**
- Create: `lib/enrich/types.ts`, `lib/enrich/router.ts`, `lib/enrich/wikipedia.ts`, `lib/enrich/youtube.ts`, `lib/enrich/github.ts`, `tests/fixtures/enrich/wikipedia-en.json`, `tests/fixtures/enrich/youtube-oembed.json`, `tests/fixtures/enrich/github-repo.json`, `tests/unit/enrich-router.test.ts`, `tests/unit/enrich-free.test.ts`

**Interfaces:**
- Produces:
```ts
// lib/enrich/types.ts
export interface Fetched { source: EnrichSource; title?: string; excerpt?: string; ogImage?: string; language?: string; thin: boolean; }
export type Adapter = (url: string, ctx: AdapterCtx) => Promise<Fetched | null>;   // null = "not mine / not found, try next"
export interface AdapterCtx { fetchImpl: typeof fetch; firecrawlKey?: string; userAgent: string; }
// lib/enrich/router.ts
export type Host = "wikipedia" | "youtube" | "arxiv" | "github" | "doi" | "generic" | "xmedia";
export function routeHost(url: string): Host;
export function wikipediaTitle(url: string): { lang: string; title: string } | null;
export function arxivId(url: string): string | null;
export function doiOf(url: string): string | null;
export function youtubeId(url: string): string | null;
export function githubRepo(url: string): { owner: string; repo: string } | null;
```
- Each adapter exports one function of type `Adapter`: `fetchWikipedia`, `fetchYoutube`, `fetchGithub`.
- User-Agent for all free APIs: `research.nalenz.org/1.0 (https://github.com/hermesloom/research-map; info@divizend.com)`.

- [ ] **Step 1: Record fixtures** (real responses, one call each, saved once):

```bash
mkdir -p tests/fixtures/enrich
UA='research.nalenz.org/1.0 (https://github.com/hermesloom/research-map)'
curl -s -A "$UA" 'https://en.wikipedia.org/api/rest_v1/page/summary/Yoneda_lemma' > tests/fixtures/enrich/wikipedia-en.json
curl -s 'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=tETbivwzXBM&format=json' > tests/fixtures/enrich/youtube-oembed.json
curl -s -A "$UA" 'https://api.github.com/repos/apple/embedding-atlas' > tests/fixtures/enrich/github-repo.json
```

- [ ] **Step 2: Write the failing router tests**

`tests/unit/enrich-router.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { routeHost, wikipediaTitle, arxivId, doiOf, youtubeId, githubRepo } from "@/lib/enrich/router";

describe("routeHost", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Yoneda_lemma", "wikipedia"],
    ["https://de.wikipedia.org/wiki/Pfadabh%C3%A4ngigkeit", "wikipedia"],
    ["https://www.youtube.com/watch?v=tETbivwzXBM", "youtube"],
    ["https://youtu.be/j9ZkpMdG1hg", "youtube"],
    ["https://arxiv.org/pdf/2103.03198", "arxiv"],
    ["https://arxiv.org/html/2607.26300", "arxiv"],
    ["https://github.com/CategoricalData/hydra", "github"],
    ["https://doi.org/10.1145/3158140", "doi"],
    ["https://dl.acm.org/doi/10.1145/3158140", "doi"],
    ["https://xtdb.com/", "generic"],
    ["https://x.com/sigalor/status/2116647051207291080/photo/1", "xmedia"],
  ])("%s → %s", (url, host) => expect(routeHost(url)).toBe(host));
});

describe("wikipedia title extraction handles encoding and fragments", () => {
  it("decodes and strips fragments", () => {
    expect(wikipediaTitle("https://de.wikipedia.org/wiki/Christian_Wolff_%28Aufkl%C3%A4rer%29")).toEqual({ lang: "de", title: "Christian_Wolff_(Aufklärer)" });
    expect(wikipediaTitle("https://en.wikipedia.org/wiki/Robert_Kegan#The_Evolving_Self")).toEqual({ lang: "en", title: "Robert_Kegan" });
    expect(wikipediaTitle("https://en.wiktionary.org/wiki/sympoiesis")).toBeNull();
  });
});

describe("id extractors", () => {
  it("arxiv", () => { expect(arxivId("https://arxiv.org/pdf/1711.07059v2")).toBe("1711.07059"); expect(arxivId("https://arxiv.org/abs/math/0305282")).toBe("math/0305282"); });
  it("doi", () => { expect(doiOf("https://dl.acm.org/doi/pdf/10.1145/3144555.3144560")).toBe("10.1145/3144555.3144560"); expect(doiOf("https://xtdb.com/")).toBeNull(); });
  it("youtube", () => { expect(youtubeId("https://www.youtube.com/watch?si=abc&v=e88CdSBBY-k&feature=youtu.be")).toBe("e88CdSBBY-k"); expect(youtubeId("https://youtu.be/j9ZkpMdG1hg")).toBe("j9ZkpMdG1hg"); expect(youtubeId("https://www.youtube.com/@Henophilia/videos")).toBeNull(); });
  it("github", () => { expect(githubRepo("https://github.com/eyereasoner/lingua")).toEqual({ owner: "eyereasoner", repo: "lingua" }); expect(githubRepo("https://github.com/euro-office")).toBeNull(); });
});
```

- [ ] **Step 3: Run** → FAIL

- [ ] **Step 4: Write `lib/enrich/types.ts` and `lib/enrich/router.ts`**

```ts
// lib/enrich/router.ts
export type Host = "wikipedia" | "youtube" | "arxiv" | "github" | "doi" | "generic" | "xmedia";
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>?#]+)/i;

export function wikipediaTitle(url: string): { lang: string; title: string } | null {
  let u: URL; try { u = new URL(url); } catch { return null; }
  const m = u.hostname.match(/^([a-z]{2,3})\.(m\.)?wikipedia\.org$/);
  if (!m || !u.pathname.startsWith("/wiki/")) return null;
  const raw = u.pathname.slice("/wiki/".length);
  let title: string; try { title = decodeURIComponent(raw); } catch { title = raw; }
  return { lang: m[1], title };
}
export function youtubeId(url: string): string | null {
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (/(^|\.)youtube\.com$/.test(u.hostname)) {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/); if (m) return m[2];
  }
  return null;
}
export function arxivId(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf|html)\/((?:[a-z-]+\/)?\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/i);
  return m ? m[1] : null;
}
export function doiOf(url: string): string | null { const m = url.match(DOI_RE); return m ? m[1].replace(/\.(pdf|html)$/i, "") : null; }
export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/); return m ? { owner: m[1], repo: m[2] } : null;
}
export function routeHost(url: string): Host {
  if (/^https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\/(photo|video)\//.test(url)) return "xmedia";
  if (wikipediaTitle(url)) return "wikipedia";
  if (youtubeId(url)) return "youtube";
  if (arxivId(url)) return "arxiv";
  if (githubRepo(url)) return "github";
  if (doiOf(url)) return "doi";
  return "generic";
}
```

- [ ] **Step 5: Run router tests** → PASS

- [ ] **Step 6: Write the failing adapter tests**

`tests/unit/enrich-free.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fetchWikipedia } from "@/lib/enrich/wikipedia";
import { fetchYoutube } from "@/lib/enrich/youtube";
import { fetchGithub } from "@/lib/enrich/github";
const fx = (n: string) => fs.readFileSync(`tests/fixtures/enrich/${n}`, "utf8");
const ctx = (body: string, status = 200) => ({ fetchImpl: (async () => new Response(body, { status })) as any, userAgent: "test" });

describe("free adapters", () => {
  it("wikipedia returns title + extract and sets language", async () => {
    const r = await fetchWikipedia("https://en.wikipedia.org/wiki/Yoneda_lemma", ctx(fx("wikipedia-en.json")));
    expect(r!.source).toBe("wikipedia"); expect(r!.title).toMatch(/Yoneda/); expect(r!.excerpt!.length).toBeGreaterThan(100); expect(r!.language).toBe("en"); expect(r!.thin).toBe(false);
  });
  it("wikipedia returns null on 404", async () => { expect(await fetchWikipedia("https://en.wikipedia.org/wiki/Nope_nope", ctx("{}", 404))).toBeNull(); });
  it("youtube oembed returns title + author as excerpt", async () => {
    const r = await fetchYoutube("https://www.youtube.com/watch?v=tETbivwzXBM", ctx(fx("youtube-oembed.json")));
    expect(r!.source).toBe("oembed"); expect(r!.title).toBeTruthy(); expect(r!.excerpt).toMatch(/by /); expect(r!.ogImage).toMatch(/ytimg/);
  });
  it("github returns description + topics", async () => {
    const r = await fetchGithub("https://github.com/apple/embedding-atlas", ctx(fx("github-repo.json")));
    expect(r!.source).toBe("github"); expect(r!.title).toBe("apple/embedding-atlas"); expect(r!.excerpt).toMatch(/embedding/i);
  });
});
```

- [ ] **Step 7: Run** → FAIL

- [ ] **Step 8: Write the three adapters**

```ts
// lib/enrich/wikipedia.ts
import type { Adapter } from "./types"; import { wikipediaTitle } from "./router";
export const fetchWikipedia: Adapter = async (url, ctx) => {
  const w = wikipediaTitle(url); if (!w) return null;
  const res = await ctx.fetchImpl(`https://${w.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.title)}`, { headers: { "User-Agent": ctx.userAgent, Accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; description?: string; extract?: string; thumbnail?: { source?: string }; lang?: string };
  if (!j.extract) return null;
  return { source: "wikipedia", title: j.title, excerpt: [j.description, j.extract].filter(Boolean).join(" — ").slice(0, 1500), ogImage: j.thumbnail?.source, language: j.lang ?? w.lang, thin: false };
};
// lib/enrich/youtube.ts
import type { Adapter } from "./types"; import { youtubeId } from "./router";
export const fetchYoutube: Adapter = async (url, ctx) => {
  const id = youtubeId(url); if (!id) return null;
  const res = await ctx.fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  if (!j.title) return null;
  return { source: "oembed", title: j.title, excerpt: `Video "${j.title}" by ${j.author_name ?? "unknown"} on YouTube.`, ogImage: j.thumbnail_url, thin: false };
};
// lib/enrich/github.ts
import type { Adapter } from "./types"; import { githubRepo } from "./router";
export const fetchGithub: Adapter = async (url, ctx) => {
  const r = githubRepo(url); if (!r) return null;
  const res = await ctx.fetchImpl(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: { "User-Agent": ctx.userAgent, Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as { full_name?: string; description?: string | null; topics?: string[]; language?: string | null; stargazers_count?: number };
  return { source: "github", title: j.full_name ?? `${r.owner}/${r.repo}`,
    excerpt: [j.description ?? "", j.topics?.length ? `Topics: ${j.topics.join(", ")}.` : "", j.language ? `Language: ${j.language}.` : ""].filter(Boolean).join(" ").slice(0, 1000) || undefined, thin: !j.description };
};
```
`lib/enrich/types.ts` as in Interfaces.

- [ ] **Step 9: Run** → PASS
- [ ] **Step 10: Commit** — `git add lib/enrich tests/unit/enrich-*.test.ts tests/fixtures/enrich && git commit -m "feat: enrichment router and free adapters"`

### Task 7: Enrichment — arXiv, OpenAlex, Firecrawl, Wayback, thin record, and the ladder

**Files:**
- Create: `lib/enrich/arxiv.ts`, `lib/enrich/openalex.ts`, `lib/enrich/firecrawl.ts`, `lib/enrich/wayback.ts`, `lib/enrich/ladder.ts`, `tests/fixtures/enrich/arxiv.xml`, `tests/fixtures/enrich/openalex.json`, `tests/fixtures/enrich/firecrawl-page.json`, `tests/unit/enrich-ladder.test.ts`

**Interfaces:**
- Consumes: Task 6 adapters and router.
- Produces: `enrichUrl(url: string, ctx: AdapterCtx): Promise<Fetched>` — never throws, never returns null; last rung is `thinRecord(url)` = `{ source: "thin", title: <domain + path words>, excerpt: undefined, thin: true }`. Also `reconstructAbstract(inv: Record<string, number[]>): string` for OpenAlex.
- Firecrawl: `POST https://api.firecrawl.dev/v2/scrape` with `{ url, formats: ["markdown","summary"], onlyMainContent: true, parsers: [{ type: "pdf", maxPages: 5 }] }`, header `Authorization: Bearer <key>`. Result: `{ success, data: { markdown, summary, metadata: { title, description, ogImage, language, statusCode } } }`. Treat HTTP 402 (credits exhausted) as `QuotaExhausted` → ladder returns `{ source: "none", thin: true, deferred: true }` so the stage can be retried next run.

- [ ] **Step 1: Record fixtures**
```bash
curl -s 'https://export.arxiv.org/api/query?id_list=1711.07059' > tests/fixtures/enrich/arxiv.xml
curl -s -A 'research.nalenz.org/1.0' 'https://api.openalex.org/works/https://doi.org/10.1145/3158140' > tests/fixtures/enrich/openalex.json
# Firecrawl: ONE real call (1 credit) to record the shape
curl -s -X POST https://api.firecrawl.dev/v2/scrape -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"url":"https://xtdb.com/","formats":["markdown","summary"],"onlyMainContent":true}' > tests/fixtures/enrich/firecrawl-page.json
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/enrich-ladder.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fetchArxiv } from "@/lib/enrich/arxiv";
import { fetchOpenAlex, reconstructAbstract } from "@/lib/enrich/openalex";
import { fetchFirecrawl, QuotaExhausted } from "@/lib/enrich/firecrawl";
import { enrichUrl, thinRecord } from "@/lib/enrich/ladder";
const fx = (n: string) => fs.readFileSync(`tests/fixtures/enrich/${n}`, "utf8");
const seq = (responses: Array<[number, string]>) => { let i = 0; return (async () => { const [s, b] = responses[Math.min(i++, responses.length - 1)]; return new Response(b, { status: s }); }) as any; };

describe("paper adapters", () => {
  it("arxiv parses title and abstract from Atom", async () => {
    const r = await fetchArxiv("https://arxiv.org/html/1711.07059v2", { fetchImpl: seq([[200, fx("arxiv.xml")]]), userAgent: "t" });
    expect(r!.source).toBe("arxiv"); expect(r!.title).toMatch(/open games/i); expect(r!.excerpt!.length).toBeGreaterThan(200);
  });
  it("openalex reconstructs abstract from inverted index", () => {
    expect(reconstructAbstract({ Towers: [0], of: [1], interpreters: [2] })).toBe("Towers of interpreters");
  });
  it("openalex adapter resolves a DOI url", async () => {
    const r = await fetchOpenAlex("https://dl.acm.org/doi/10.1145/3158140", { fetchImpl: seq([[200, fx("openalex.json")]]), userAgent: "t" });
    expect(r!.source).toBe("openalex"); expect(r!.title).toMatch(/interpreters/i);
  });
});

describe("firecrawl", () => {
  it("returns title + summary and marks thin when summary empty", async () => {
    const r = await fetchFirecrawl("https://xtdb.com/", { fetchImpl: seq([[200, fx("firecrawl-page.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r!.source).toBe("firecrawl"); expect(r!.title).toBeTruthy(); expect(r!.excerpt!.length).toBeGreaterThan(50);
  });
  it("throws QuotaExhausted on 402", async () => {
    await expect(fetchFirecrawl("https://a.b/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k" })).rejects.toBeInstanceOf(QuotaExhausted);
  });
  it("returns null without a key", async () => { expect(await fetchFirecrawl("https://a.b/", { fetchImpl: seq([[200, "{}"]]), userAgent: "t" })).toBeNull(); });
});

describe("enrichUrl ladder", () => {
  it("uses wikipedia first for wikipedia urls", async () => {
    const r = await enrichUrl("https://en.wikipedia.org/wiki/Yoneda_lemma", { fetchImpl: seq([[200, fx("wikipedia-en.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("wikipedia");
  });
  it("falls from a paywalled generic page to openalex via DOI", async () => {
    const r = await enrichUrl("https://dl.acm.org/doi/10.1145/3158140", { fetchImpl: seq([[200, fx("openalex.json")]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("openalex");
  });
  it("falls through to wayback then thin on a dead generic page", async () => {
    const dead = seq([[500, "{}"], [200, JSON.stringify({ archived_snapshots: {} })]]);
    const r = await enrichUrl("https://dead.example.org/some/long-path-name", { fetchImpl: dead, userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("thin"); expect(r.thin).toBe(true); expect(r.title).toMatch(/dead\.example\.org/); expect(r.title).toMatch(/long path name/);
  });
  it("defers (source none) when firecrawl quota is exhausted", async () => {
    const r = await enrichUrl("https://xtdb.com/", { fetchImpl: seq([[402, "{}"]]), userAgent: "t", firecrawlKey: "k" });
    expect(r.source).toBe("none"); expect((r as any).deferred).toBe(true);
  });
  it("thinRecord humanizes the path", () => { expect(thinRecord("https://foo.org/a_b-c/d.pdf").title).toBe("foo.org · a b c d"); });
});
```

- [ ] **Step 3: Run** → FAIL

- [ ] **Step 4: Write the adapters and ladder**

```ts
// lib/enrich/arxiv.ts
import type { Adapter } from "./types"; import { arxivId } from "./router";
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/\s+/g, " ").trim() : undefined; };
export const fetchArxiv: Adapter = async (url, ctx) => {
  const id = arxivId(url); if (!id) return null;
  const res = await ctx.fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const xml = await res.text(); const entry = xml.split("<entry>")[1]; if (!entry) return null;
  const title = tag(entry, "title"); const summary = tag(entry, "summary"); if (!title) return null;
  const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 4).join(", ");
  return { source: "arxiv", title, excerpt: [authors ? `${authors}.` : "", summary ?? ""].join(" ").trim().slice(0, 1500), thin: false };
};
// lib/enrich/openalex.ts
import type { Adapter } from "./types"; import { doiOf } from "./router";
export function reconstructAbstract(inv: Record<string, number[]>): string {
  const words: string[] = []; for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w; return words.filter(Boolean).join(" ");
}
export const fetchOpenAlex: Adapter = async (url, ctx) => {
  const doi = doiOf(url); if (!doi) return null;
  const res = await ctx.fetchImpl(`https://api.openalex.org/works/https://doi.org/${doi}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; abstract_inverted_index?: Record<string, number[]> | null; publication_year?: number; primary_location?: { source?: { display_name?: string } } };
  if (!j.title) return null;
  const abs = j.abstract_inverted_index ? reconstructAbstract(j.abstract_inverted_index) : "";
  return { source: "openalex", title: j.title, excerpt: [j.primary_location?.source?.display_name, j.publication_year, abs].filter(Boolean).join(". ").slice(0, 1500) || undefined, thin: !abs };
};
// lib/enrich/firecrawl.ts
import type { Adapter } from "./types";
export class QuotaExhausted extends Error {}
export const fetchFirecrawl: Adapter = async (url, ctx) => {
  if (!ctx.firecrawlKey) return null;
  const res = await ctx.fetchImpl("https://api.firecrawl.dev/v2/scrape", { method: "POST", headers: { Authorization: `Bearer ${ctx.firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "summary"], onlyMainContent: true, parsers: [{ type: "pdf", maxPages: 5 }] }) });
  if (res.status === 402) throw new QuotaExhausted("firecrawl credits exhausted");
  if (!res.ok) return null;
  const j = (await res.json()) as { success?: boolean; data?: { markdown?: string; summary?: string; metadata?: { title?: string; description?: string; ogImage?: string; language?: string; statusCode?: number } } };
  const d = j.data; if (!j.success || !d) return null;
  const sc = d.metadata?.statusCode ?? 200; if (sc === 401 || sc === 402 || sc === 403 || sc === 404) return null;
  const body = (d.summary && d.summary.length > 40 ? d.summary : (d.markdown ?? "").replace(/\s+/g, " ").slice(0, 1200)).trim();
  if (body.length < 300 && /subscribe|sign in|log in|paywall/i.test(body)) return null;
  return { source: "firecrawl", title: d.metadata?.title, excerpt: [d.metadata?.description, body].filter(Boolean).join(" — ").slice(0, 1500) || undefined, ogImage: d.metadata?.ogImage, language: d.metadata?.language, thin: body.length < 80 };
};
// lib/enrich/wayback.ts
import type { AdapterCtx } from "./types";
export async function waybackUrl(url: string, ctx: AdapterCtx): Promise<string | null> {
  const res = await ctx.fetchImpl(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": ctx.userAgent } });
  if (!res.ok) return null;
  const j = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
  return j.archived_snapshots?.closest?.available ? j.archived_snapshots.closest.url ?? null : null;
}
// lib/enrich/ladder.ts
import type { AdapterCtx, Fetched } from "./types"; import { routeHost, domainWords } from "./router";
import { fetchWikipedia } from "./wikipedia"; import { fetchYoutube } from "./youtube"; import { fetchGithub } from "./github";
import { fetchArxiv } from "./arxiv"; import { fetchOpenAlex } from "./openalex"; import { fetchFirecrawl, QuotaExhausted } from "./firecrawl"; import { waybackUrl } from "./wayback";

export function thinRecord(url: string): Fetched {
  let u: URL; try { u = new URL(url); } catch { return { source: "thin", title: url.slice(0, 80), thin: true }; }
  const words = u.pathname.split(/[\/._\-%+]+/).filter((w) => w && !/^\d+$/.test(w) && !/^(pdf|html|htm|php)$/i.test(w)).join(" ");
  return { source: "thin", title: `${u.hostname.replace(/^www\./, "")}${words ? ` · ${words}` : ""}`.slice(0, 120), thin: true };
}
const safe = async (f: () => Promise<Fetched | null>) => { try { return await f(); } catch (e) { if (e instanceof QuotaExhausted) throw e; return null; } };

export async function enrichUrl(url: string, ctx: AdapterCtx): Promise<Fetched & { deferred?: boolean }> {
  const host = routeHost(url);
  const order: Array<() => Promise<Fetched | null>> = [];
  if (host === "wikipedia") order.push(() => fetchWikipedia(url, ctx));
  if (host === "youtube") order.push(() => fetchYoutube(url, ctx));
  if (host === "arxiv") order.push(() => fetchArxiv(url, ctx));
  if (host === "github") order.push(() => fetchGithub(url, ctx));
  if (host === "doi") order.push(() => fetchOpenAlex(url, ctx));
  order.push(() => fetchFirecrawl(url, ctx));
  if (host !== "doi") order.push(() => fetchOpenAlex(url, ctx)); // DOI may still be in the url
  order.push(async () => { const w = await waybackUrl(url, ctx); return w ? fetchFirecrawl(w, ctx) : null; });
  try {
    for (const step of order) { const r = await safe(step); if (r && (r.title || r.excerpt)) return r; }
  } catch (e) {
    if (e instanceof QuotaExhausted) return { source: "none", thin: true, deferred: true };
    throw e;
  }
  return thinRecord(url);
}
```
Add to `lib/enrich/router.ts`: `export function domainWords(url: string) { ... }` is **not** needed — remove that import; `thinRecord` is self-contained. (Keep the file compiling: do not import `domainWords`.)

Note on the paywall test: the ladder tries Firecrawl before OpenAlex for `doi` hosts? No — for `host === "doi"` OpenAlex is first (free), Firecrawl second. The "paywalled generic page" test passes because `dl.acm.org/doi/...` routes to `doi`.

- [ ] **Step 5: Run** → PASS
- [ ] **Step 6: Commit** — `git add lib/enrich tests && git commit -m "feat: paper adapters, firecrawl, wayback, enrichment ladder"`

### Task 8: Vision OCR, Blob re-hosting, OpenAI client wrapper

**Files:**
- Create: `lib/llm/openai.ts`, `lib/blob.ts`, `lib/enrich/vision.ts`, `tests/unit/vision.test.ts`

**Interfaces:**
- Produces:
  - `lib/llm/openai.ts`: `getOpenAI(): OpenAI` (singleton from env), `parseStructured<T>(schema: ZodType<T>, name: string, input: ResponseInput, model: string): Promise<T>` which calls `client.responses.parse({ model, input, text: { format: zodTextFormat(schema, name) } })` and returns `output_parsed` (throws `LLMParseError` when null).
  - `lib/blob.ts`: `putPublic(pathname: string, body: Buffer | string, contentType: string): Promise<string /*url*/>` using `@vercel/blob` `put(pathname, body, { access: "public", addRandomSuffix: false, contentType, cacheControlMaxAge: 31536000 })`. In tests it is mocked.
  - `lib/enrich/vision.ts`: `VisionSchema = z.object({ transcript: z.string().max(4000), kind: z.enum(["screenshot_text","photo","diagram","meme","ui","document","other"]), description: z.string().max(400), title: z.string().max(100) })`; `describeImage(imageUrl: string, deps = { parse: parseStructured, fetchImpl: fetch, put: putPublic }): Promise<{ vision: Vision; thumbUrl: string; originalMediaUrl: string }>` — downloads the image bytes, uploads original to `media/<sha1>.jpg` and the same bytes as `thumbs/<sha1>.jpg` (resizing is done in the batch job later; v1 ships the original as thumb — recorded as known simplification), and sends the image to the vision model as a data URL `input_image` with `detail: "high"`.

- [ ] **Step 1: Write the failing test**

`tests/unit/vision.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { describeImage, VISION_PROMPT } from "@/lib/enrich/vision";

describe("describeImage", () => {
  it("downloads, uploads, and asks the model with the image as data url", async () => {
    const puts: string[] = []; let gotInput: any;
    const deps = {
      fetchImpl: (async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0x00]), { headers: { "content-type": "image/jpeg" } })) as any,
      put: async (p: string) => { puts.push(p); return `https://blob/${p}`; },
      parse: async (_s: any, _n: string, input: any) => { gotInput = input; return { transcript: "Hello", kind: "screenshot_text", description: "A screenshot", title: "Hello" }; },
    };
    const r = await describeImage("https://pbs.twimg.com/media/abc.jpg", deps as any);
    expect(puts[0]).toMatch(/^media\/[0-9a-f]{40}\.jpg$/); expect(puts[1]).toMatch(/^thumbs\//);
    expect(r.vision.transcript).toBe("Hello"); expect(r.thumbUrl).toContain("thumbs/");
    const img = gotInput[0].content.find((c: any) => c.type === "input_image");
    expect(img.image_url.startsWith("data:image/jpeg;base64,")).toBe(true); expect(img.detail).toBe("high");
    expect(gotInput[0].content[0].text).toBe(VISION_PROMPT);
  });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Write the three modules**

```ts
// lib/llm/openai.ts
import OpenAI from "openai"; import { zodTextFormat } from "openai/helpers/zod"; import type { ZodType } from "zod"; import { env } from "../env";
let c: OpenAI | null = null;
export function getOpenAI() { return (c ??= new OpenAI({ apiKey: env().OPENAI_API_KEY })); }
export class LLMParseError extends Error {}
export type ResponseInput = Parameters<OpenAI["responses"]["parse"]>[0]["input"];
export async function parseStructured<T>(schema: ZodType<T>, name: string, input: ResponseInput, model = env().OPENAI_TEXT_MODEL): Promise<T> {
  const r = await getOpenAI().responses.parse({ model, input, text: { format: zodTextFormat(schema as any, name) }, reasoning: { effort: "low" } as any });
  if (!r.output_parsed) throw new LLMParseError(`No parsed output for ${name}: ${r.output_text?.slice(0, 200)}`);
  return r.output_parsed as T;
}
// lib/blob.ts
import { put } from "@vercel/blob";
export async function putPublic(pathname: string, body: Buffer | string, contentType: string): Promise<string> {
  const r = await put(pathname, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 31536000 });
  return r.url;
}
// lib/enrich/vision.ts
import { createHash } from "node:crypto"; import { z } from "zod"; import { env } from "../env"; import { parseStructured } from "../llm/openai"; import { putPublic } from "../blob";
export const VisionSchema = z.object({ transcript: z.string().max(4000), kind: z.enum(["screenshot_text", "photo", "diagram", "meme", "ui", "document", "other"]), description: z.string().max(400), title: z.string().max(100) });
export type Vision = z.infer<typeof VisionSchema>;
export const VISION_PROMPT = "First transcribe ALL legible text in the image verbatim (keep the original language; use line breaks). Then classify the image kind, write a one-sentence neutral description in English, and a short title (max 8 words). If there is no text, transcript is an empty string.";
export async function describeImage(imageUrl: string, deps = { parse: parseStructured, fetchImpl: fetch, put: putPublic }) {
  const res = await deps.fetchImpl(imageUrl); if (!res.ok) throw new Error(`image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer()); const ct = res.headers.get("content-type") ?? "image/jpeg"; const ext = ct.includes("png") ? "png" : "jpg";
  const sha = createHash("sha1").update(buf).digest("hex");
  const originalMediaUrl = await deps.put(`media/${sha}.${ext}`, buf, ct);
  const thumbUrl = await deps.put(`thumbs/${sha}.${ext}`, buf, ct);
  const vision = await deps.parse(VisionSchema, "vision", [{ role: "user", content: [{ type: "input_text", text: VISION_PROMPT }, { type: "input_image", image_url: `data:${ct};base64,${buf.toString("base64")}`, detail: "high" }] }] as any, env().OPENAI_VISION_MODEL);
  return { vision, thumbUrl, originalMediaUrl };
}
```
Note: if `reasoning: { effort: "low" }` is rejected for a model, remove it; keep temperature unset for gpt-5.x (not accepted).

- [ ] **Step 4: Run** → PASS; then `pnpm typecheck`.
- [ ] **Step 5: Commit** — `git add lib/llm/openai.ts lib/blob.ts lib/enrich/vision.ts tests/unit/vision.test.ts && git commit -m "feat: openai wrapper, blob upload, vision OCR"`

### Task 9: Normalize (LLM gist) with empty-input guard and parent context

**Files:**
- Create: `lib/llm/normalize.ts`, `tests/unit/normalize.test.ts`

**Interfaces:**
- Consumes: `NormalizedSchema`, `Item`, `Fetched`/`Enrichment`, `parseStructured`.
- Produces: `buildNormalizeInput(item: Item, enrich: Partial<Enrichment>, parent?: Item | null): { text: string; empty: boolean }` and `normalizeItem(item, enrich, parent, deps = { parse: parseStructured }): Promise<Normalized | null>` (null ⇔ empty input). `NORMALIZE_SYSTEM` prompt constant.

- [ ] **Step 1: Write the failing test**

`tests/unit/normalize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildNormalizeInput, normalizeItem } from "@/lib/llm/normalize";
const base = { xId: "1", createdAt: new Date("2026-10-01"), urls: [], media: [], isResearchQuestion: false, stage: "enriched", fetchedAt: new Date() } as any;

describe("normalize", () => {
  it("empty guard: no text, no transcript, no title → empty", () => {
    const r = buildNormalizeInput({ ...base, text: "https://t.co/x", kind: "media" }, { transcript: "", title: undefined });
    expect(r.empty).toBe(true);
  });
  it("includes page title/excerpt and transcript", () => {
    const r = buildNormalizeInput({ ...base, text: "https://t.co/x", kind: "link" }, { title: "XTDB", excerpt: "A bitemporal database." });
    expect(r.empty).toBe(false); expect(r.text).toContain("XTDB"); expect(r.text).toContain("bitemporal");
  });
  it("normalize self-reply without parent still works", async () => {
    const out = await normalizeItem({ ...base, text: "and this is why", kind: "selfReply", parentId: "0" }, {}, null, { parse: async () => ({ title: "t", summaryEn: "s", gist: "g", tagsEn: [], language: "en", entities: [], contentKind: "thought" }) } as any);
    expect(out!.title).toBe("t");
  });
  it("prepends parent text for self-replies when available", () => {
    const r = buildNormalizeInput({ ...base, text: "child", kind: "selfReply", parentId: "0" }, {}, { ...base, xId: "0", text: "PARENT TEXT", kind: "text" });
    expect(r.text.indexOf("PARENT TEXT")).toBeLessThan(r.text.indexOf("child"));
  });
  it("returns null for empty input without calling the model", async () => {
    let called = false;
    const out = await normalizeItem({ ...base, text: "", kind: "media" }, {}, null, { parse: async () => { called = true; return {} as any; } } as any);
    expect(out).toBeNull(); expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Write `lib/llm/normalize.ts`**

```ts
import type { Enrichment, Item, Normalized } from "../types"; import { NormalizedSchema } from "../types"; import { parseStructured } from "./openai";
const URL_RE = /https?:\/\/\S+/g;
export const NORMALIZE_SYSTEM = `You normalize one social-media post by a researcher into structured metadata for a topic map. Posts may be English or German; bare links come with fetched page text; screenshots come with an OCR transcript.
Return: title (≤12 words, in English, specific), summaryEn (ONE sentence in English saying what the post is about and why someone would care — this is what gets embedded, so be concrete and avoid boilerplate like "Wikipedia article"), gist (1–2 sentences in the post's own language), tagsEn (3–8 lowercase English tags, canonical nouns), language, entities (named things: people, systems, standards, works), contentKind.`;

export function buildNormalizeInput(item: Item, enrich: Partial<Enrichment>, parent?: Item | null): { text: string; empty: boolean } {
  const own = item.text.replace(URL_RE, "").trim();
  const parts: string[] = [];
  if (parent) parts.push(`Parent post (same author):\n${parent.text.replace(URL_RE, "").trim()}`);
  if (own) parts.push(`Post text:\n${own}`);
  const urls = item.urls.filter((u) => !u.isMedia);
  if (urls.length) parts.push(`Links:\n${urls.map((u) => `- ${u.expandedUrl}${u.title ? ` [${u.title}]` : ""}`).join("\n")}`);
  if (enrich.title || enrich.excerpt) parts.push(`Fetched page:\nTitle: ${enrich.title ?? ""}\n${(enrich.excerpt ?? "").slice(0, 1500)}`);
  if (enrich.transcript || enrich.imageDescription) parts.push(`Image:\n${enrich.imageDescription ?? ""}\nTranscript:\n${(enrich.transcript ?? "").slice(0, 2500)}`);
  const substantive = !!(own || enrich.title || enrich.excerpt || enrich.transcript || enrich.imageDescription || urls.some((u) => u.title));
  return { text: parts.join("\n\n"), empty: !substantive };
}
export async function normalizeItem(item: Item, enrich: Partial<Enrichment>, parent: Item | null, deps = { parse: parseStructured }): Promise<Normalized | null> {
  const { text, empty } = buildNormalizeInput(item, enrich, parent); if (empty) return null;
  return deps.parse(NormalizedSchema, "normalized", [{ role: "system", content: NORMALIZE_SYSTEM }, { role: "user", content: text }] as any);
}
```

- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `git add lib/llm/normalize.ts tests/unit/normalize.test.ts && git commit -m "feat: LLM normalization with empty-input guard"`

### Task 10: Embed and hash

**Files:**
- Create: `lib/hash.ts`, `lib/llm/embed.ts`, `tests/unit/embed.test.ts`

**Interfaces:**
- Produces: `sha256(s: string): string`; `embedTexts(texts: string[], deps = { client: getOpenAI() }): Promise<number[][]>` batching 100 per request with `model: env().EMBEDDING_MODEL, dimensions: env().EMBEDDING_DIMS, input: batch`; `embeddingInput(n: Normalized): string` = `${n.title}. ${n.summaryEn}` ; `cosine(a: number[], b: number[]): number`; `jitterFromId(xId: string): [number, number]` deterministic in [-1, 1]² from sha256.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { embedTexts, embeddingInput, cosine, jitterFromId } from "@/lib/llm/embed";
describe("embed", () => {
  it("batches by 100 and preserves order", async () => {
    const calls: number[] = [];
    const client = { embeddings: { create: async ({ input }: any) => { calls.push(input.length); return { data: input.map((_: any, i: number) => ({ index: i, embedding: [input.length, i] })) }; } } };
    const out = await embedTexts(Array.from({ length: 150 }, (_, i) => `t${i}`), { client } as any);
    expect(calls).toEqual([100, 50]); expect(out.length).toBe(150); expect(out[149]).toEqual([50, 49]);
  });
  it("cosine and deterministic jitter", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1); expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(jitterFromId("abc")).toEqual(jitterFromId("abc")); expect(jitterFromId("abc")).not.toEqual(jitterFromId("abd"));
    const [jx, jy] = jitterFromId("x"); expect(Math.abs(jx)).toBeLessThanOrEqual(1); expect(Math.abs(jy)).toBeLessThanOrEqual(1);
  });
  it("embeddingInput joins title and summary", () => { expect(embeddingInput({ title: "A", summaryEn: "B." } as any)).toBe("A. B."); });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// lib/hash.ts
import { createHash } from "node:crypto"; export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// lib/llm/embed.ts
import { env } from "../env"; import { getOpenAI } from "./openai"; import { sha256 } from "../hash"; import type { Normalized } from "../types";
export const embeddingInput = (n: Normalized) => `${n.title.replace(/\.$/, "")}. ${n.summaryEn}`;
export async function embedTexts(texts: string[], deps?: { client: ReturnType<typeof getOpenAI> }): Promise<number[][]> {
  const client = deps?.client ?? getOpenAI(); const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const r = await client.embeddings.create({ model: env().EMBEDDING_MODEL, dimensions: env().EMBEDDING_DIMS, input: batch });
    const sorted = [...r.data].sort((a, b) => a.index - b.index); out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}
export function cosine(a: number[], b: number[]) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); }
export function jitterFromId(xId: string): [number, number] { const h = sha256(xId); const u = (s: string) => parseInt(s, 16) / 0xffffffff; return [u(h.slice(0, 8)) * 2 - 1, u(h.slice(8, 16)) * 2 - 1]; }
```

- [ ] **Step 4: Run** → PASS; **Step 5: Commit** — `git commit -am "feat: embeddings, cosine, deterministic jitter"` (after `git add lib/hash.ts lib/llm/embed.ts tests/unit/embed.test.ts`)

### Task 11: Placement (nearest-neighbour snap, jitter, leaf vote)

**Files:**
- Create: `lib/place.ts`, `tests/unit/place.test.ts`

**Interfaces:**
- Consumes: `jitterFromId`, `cosine`, `Layout`, `LayoutPoint`, `VectorDoc`.
- Produces:
```ts
export interface Neighbor { xId: string; score: number; x: number; y: number; clusterId: number; }
export function placeFromNeighbors(xId: string, neighbors: Neighbor[], opts: { medianSpacing: number; clusterNameVectors?: Map<number, number[]>; itemVector?: number[] }): LayoutPoint;
export async function knnNeighbors(db: Db, embedding: number[], layout: Layout, k = 10): Promise<Neighbor[]>;   // Atlas $vectorSearch exact:true, joined with layout.points
export function medianNNSpacing(points: LayoutPoint[]): number;   // sampled, O(n·sample)
export async function placeItem(db: Db, xId: string, embedding: number[], layout: Layout): Promise<LayoutPoint>;
```
- Rule: coordinates = nearest neighbour (highest score) `(x,y)` + `0.3 × medianSpacing × jitter`. Leaf = majority of neighbour `clusterId` (ignoring -1 unless all are -1); ties broken by cosine between `itemVector` and `clusterNameVectors`, else by the top neighbour's cluster. `provisional: true`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { placeFromNeighbors, medianNNSpacing } from "@/lib/place";
const nb = (xId: string, score: number, x: number, y: number, clusterId: number) => ({ xId, score, x, y, clusterId });

describe("placeFromNeighbors", () => {
  it("snaps to the top neighbour, never the average", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, 1), nb("b", 0.8, 100, 100, 2), nb("c", 0.7, 100, 100, 2)], { medianSpacing: 1 });
    expect(Math.hypot(p.x - 0, p.y - 0)).toBeLessThanOrEqual(0.3 * Math.SQRT2 + 1e-9);
    expect(p.provisional).toBe(true);
  });
  it("leaf by majority vote ignoring noise", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, -1), nb("b", 0.8, 0, 0, 2), nb("c", 0.7, 0, 0, 2), nb("d", 0.6, 0, 0, 3)], { medianSpacing: 1 });
    expect(p.clusterId).toBe(2);
  });
  it("tie broken by cluster name vector cosine", () => {
    const p = placeFromNeighbors("new", [nb("a", 0.9, 0, 0, 2), nb("b", 0.8, 0, 0, 3)], { medianSpacing: 1, itemVector: [0, 1], clusterNameVectors: new Map([[2, [1, 0]], [3, [0, 1]]]) });
    expect(p.clusterId).toBe(3);
  });
  it("all-noise neighbours → -1", () => { expect(placeFromNeighbors("n", [nb("a", 0.9, 0, 0, -1)], { medianSpacing: 1 }).clusterId).toBe(-1); });
  it("jitter is deterministic per id", () => {
    const a = placeFromNeighbors("same", [nb("a", 0.9, 5, 5, 1)], { medianSpacing: 2 }); const b = placeFromNeighbors("same", [nb("a", 0.9, 5, 5, 1)], { medianSpacing: 2 });
    expect(a).toEqual(b);
  });
  it("medianNNSpacing of a unit grid is 1", () => {
    const pts = []; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) pts.push({ xId: `${i}-${j}`, x: i, y: j, clusterId: 0, provisional: false });
    expect(medianNNSpacing(pts)).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Write `lib/place.ts`**

```ts
import type { Db } from "mongodb"; import type { Layout, LayoutPoint } from "./types"; import { cosine, jitterFromId } from "./llm/embed";
export interface Neighbor { xId: string; score: number; x: number; y: number; clusterId: number; }

export function medianNNSpacing(points: LayoutPoint[]): number {
  if (points.length < 2) return 1;
  const sample = points.length > 400 ? points.filter((_, i) => i % Math.ceil(points.length / 400) === 0) : points;
  const d = sample.map((p) => { let best = Infinity; for (const q of points) { if (q === p) continue; const dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd < best) best = dd; } return best; }).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 1;
}
export function placeFromNeighbors(xId: string, neighbors: Neighbor[], opts: { medianSpacing: number; clusterNameVectors?: Map<number, number[]>; itemVector?: number[] }): LayoutPoint {
  if (!neighbors.length) throw new Error("no neighbours");
  const top = [...neighbors].sort((a, b) => b.score - a.score)[0];
  const [jx, jy] = jitterFromId(xId); const r = 0.3 * opts.medianSpacing;
  const votes = new Map<number, number>(); for (const n of neighbors) if (n.clusterId !== -1) votes.set(n.clusterId, (votes.get(n.clusterId) ?? 0) + 1);
  let clusterId = -1;
  if (votes.size) {
    const max = Math.max(...votes.values()); const tied = [...votes.entries()].filter(([, v]) => v === max).map(([k]) => k);
    if (tied.length === 1) clusterId = tied[0];
    else if (opts.itemVector && opts.clusterNameVectors) clusterId = tied.map((c) => [c, opts.clusterNameVectors!.has(c) ? cosine(opts.itemVector!, opts.clusterNameVectors!.get(c)!) : -1] as const).sort((a, b) => b[1] - a[1])[0][0];
    else clusterId = tied.includes(top.clusterId) ? top.clusterId : tied[0];
  }
  return { xId, x: top.x + r * jx, y: top.y + r * jy, clusterId, provisional: true };
}
export async function knnNeighbors(db: Db, embedding: number[], layout: Layout, k = 10): Promise<Neighbor[]> {
  const byId = new Map(layout.points.map((p) => [p.xId, p]));
  const rows = await db.collection("vectors").aggregate<{ xId: string; score: number }>([
    { $vectorSearch: { index: "embedding_idx", path: "embedding", queryVector: embedding, exact: true, limit: k * 3 } },
    { $project: { _id: 0, xId: 1, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  return rows.filter((r) => byId.has(r.xId)).slice(0, k).map((r) => { const p = byId.get(r.xId)!; return { xId: r.xId, score: r.score, x: p.x, y: p.y, clusterId: p.clusterId }; });
}
export async function placeItem(db: Db, xId: string, embedding: number[], layout: Layout): Promise<LayoutPoint> {
  const neighbors = (await knnNeighbors(db, embedding, layout)).filter((n) => n.xId !== xId);
  return placeFromNeighbors(xId, neighbors, { medianSpacing: medianNNSpacing(layout.points), itemVector: embedding });
}
```

- [ ] **Step 4: Run** → PASS; **Step 5: Commit** — `git add lib/place.ts tests/unit/place.test.ts && git commit -m "feat: nearest-neighbour placement with deterministic jitter"`

### Task 12: Question seeding and relevance grading

**Files:**
- Create: `lib/llm/grade.ts`, `data/anchors.json`, `scripts/seed-questions.ts`, `tests/unit/grade.test.ts`

**Interfaces:**
- Consumes: `GradeSchema`, `Question`, `Relation`, `cosine`, `parseStructured`, `embedTexts`.
- Produces:
  - `CORE_QUESTION` constant (the research question verbatim), `SEED_SUBQUESTIONS: string[]` (six: "How can coordination structures be made explicit?", "How can they be made understandable to the people living in them?", "How can different structures interoperate without a shared master representation?", "How can structures be changed by those affected, and legitimately?", "How can plural, non-universal representations of reality coexist and still coordinate?", "Who audits and trusts these structures, and how is that trust produced?").
  - `data/anchors.json`: `{ core: [{xId, text}], adjacent: [...], unrelated: [...] }` — seeded from the experiment (core: the research question post's neighbours such as `perspect3vism`, CatColab, Goguen; unrelated: music/humour posts; adjacent: tooling posts). The implementer fills ≥ 8 per class by reading `~/x-nalenz-data/experiment_posts.csv` (columns `id,text_preview,question_cosine,relevance_adjusted`) — take the 8 highest-cosine `core`, 8 `adjacent`, 8 lowest-cosine `unrelated`. The owner edits this file later.
  - `buildGradeInput(item, normalized, candidates: Question[], anchors): ResponseInput`
  - `gradeItem(item, normalized, itemVector, questions: Question[], deps = { parse }): Promise<{ relations: Relation[]; cosineToCore: number }>` — candidates = core + 3 nearest sub-questions by cosine; writes one relation to core (grade, role, rationale, cosine) and one per returned `subQuestionIds` (same grade/role). `disagreement = (grade >= 2 && cosine < 0.12) || (grade <= 0 && cosine > 0.30)`.
  - `scripts/seed-questions.ts`: inserts core (`_id: "core"`) + six seed sub-questions (`_id: "seed-1"…`) with embeddings if missing (idempotent).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { gradeItem, CORE_QUESTION, SEED_SUBQUESTIONS, pickCandidates } from "@/lib/llm/grade";
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
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Write `lib/llm/grade.ts`**

```ts
import fs from "node:fs"; import path from "node:path"; import type { Item, Normalized, Question, Relation } from "../types"; import { GradeSchema } from "../types"; import { cosine } from "./embed"; import { parseStructured } from "./openai"; import { env } from "../env";
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
  const core = questions.find((q) => q._id === "core")!; const subs = questions.filter((q) => q._id !== "core" && !q.validTo && q.embedding);
  const nearest = subs.map((q) => [q, cosine(itemVector, q.embedding!)] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q]) => q);
  return [core, ...nearest];
}
export const GRADE_SYSTEM = `You grade how one post relates to a research question. Grade: 3 = directly addresses the question or a sub-question (evidence, worked example, tool built for it); 2 = clearly feeds into it (formal methods, knowledge representation, governance theory, infrastructure the question needs); 1 = loosely related intellectual interest; 0 = personal, humour, music, politics without structural content. Role: evidence, example, counterexample, tool, inspiration, extension, tangent, unrelated. Give a one-line rationale. subQuestionIds: pick at most 2 of the offered sub-question ids that the post genuinely speaks to (empty if grade ≤ 1).`;
export function buildGradeInput(item: Item, n: Normalized, candidates: Question[], anchors: Anchors) {
  const ex = (l: string, a: { text: string }[]) => `${l}:\n${a.slice(0, 5).map((x) => `- ${x.text.slice(0, 160)}`).join("\n")}`;
  const user = `Research question: ${CORE_QUESTION}\n\nSub-questions:\n${candidates.filter((c) => c._id !== "core").map((c) => `[${c._id}] ${c.text}`).join("\n")}\n\nCalibration examples from this author —\n${ex("Grade 3", anchors.core)}\n${ex("Grade 2", anchors.adjacent)}\n${ex("Grade 0", anchors.unrelated)}\n\nPost (${item.kind}, ${item.createdAt.toISOString().slice(0, 10)}):\nTitle: ${n.title}\nSummary: ${n.summaryEn}\nGist: ${n.gist}\nTags: ${n.tagsEn.join(", ")}`;
  return [{ role: "system", content: GRADE_SYSTEM }, { role: "user", content: user }] as any;
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
```
`scripts/seed-questions.ts`:
```ts
import { loadEnv } from "@/lib/env"; import { getDb, collections, closeDb, ensureIndexes } from "@/lib/db"; import { CORE_QUESTION, SEED_SUBQUESTIONS } from "@/lib/llm/grade"; import { embedTexts } from "@/lib/llm/embed";
loadEnv();
const db = await getDb(); await ensureIndexes(db); const { questions } = collections(db);
const texts = [CORE_QUESTION, ...SEED_SUBQUESTIONS]; const ids = ["core", ...SEED_SUBQUESTIONS.map((_, i) => `seed-${i + 1}`)];
const existing = new Set((await questions.find({ _id: { $in: ids } }).toArray()).map((q) => q._id));
const todo = ids.map((id, i) => [id, texts[i]] as const).filter(([id]) => !existing.has(id));
if (todo.length) { const vecs = await embedTexts(todo.map(([, t]) => t));
  await questions.insertMany(todo.map(([id, text], i) => ({ _id: id, text, parentId: id === "core" ? null : "core", embedding: vecs[i], validFrom: new Date(), validTo: null, origin: "seed" as const }))); }
console.log(`questions: ${existing.size} existed, ${todo.length} inserted`); await closeDb();
```
(Run scripts with `pnpm tsx --tsconfig tsconfig.json scripts/seed-questions.ts`; ensure `tsconfig.json` has `"paths": {"@/*": ["./*"]}` and tsx honours it.)

- [ ] **Step 4: Run tests** → PASS; **Step 5: Commit** — `git add lib/llm/grade.ts data/anchors.json scripts/seed-questions.ts tests/unit/grade.test.ts && git commit -m "feat: question seeds and per-post relevance grading"`

### Task 13: Snapshot builder and publish

**Files:**
- Create: `lib/snapshot.ts`, `lib/publish.ts`, `lib/overrides.ts`, `tests/unit/snapshot.test.ts`

**Interfaces:**
- Produces:
```ts
// lib/snapshot.ts (pure)
export interface PointsFile { version: 1; layoutVersion: number; generatedAt: string; count: number; ids: string[]; x: number[]; y: number[]; leaf: number[]; theme: number[]; grade: number[];
  provisional: number[]; createdAt: number[]; kind: number[]; themes: { id: number; label: string }[]; leaves: { id: number; label: string; themeId: number; x: number; y: number; size: number }[]; kinds: string[]; }
export interface MetaFile { version: 1; ids: string[]; title: string[]; gist: string[]; url: (string | null)[]; domain: (string | null)[]; thumb: (string | null)[]; role: string[]; rationale: string[]; tags: string[][]; lang: string[]; subQuestions: string[][]; }
export interface LabelsFile { version: 1; labels: { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number }[]; hulls: { clusterId: number; polygon: [number, number][] }[]; questions: { id: string; text: string; parentId: string | null }[]; }
export function buildSnapshot(input: { layout: Layout; items: Item[]; enrichment: Map<string, Enrichment>; relations: Map<string, Relation[]>; questions: Question[]; overrides: Override[]; generatedAt: Date }): { points: PointsFile; meta: MetaFile; labels: LabelsFile };
// lib/overrides.ts
export function applyOverrides(layout: Layout, overrides: Override[]): Layout;   // pin → x,y; renameLabel → clusters[].label + labels[].text; moveLeaf → points[].clusterId
// lib/publish.ts
export async function publishSnapshot(db: Db, deps = { put: putPublic }): Promise<Manifest>;  // loads everything, builds, uploads canvas/<ts>/{points,meta,labels}.json, upserts manifest
```
- Rules: items with `deletedAt` or missing from `items` are dropped; items with no relation get grade 1 and role "tangent" (ungraded ≠ hidden); `kind` index into `kinds` array; label `level`: themes 0, leaves 1, item titles 2 (text), thumbnails 2 (image labels for media items with `thumbUrl`, width 96 height 64, priority = grade); leaf label priority = size × (1 + mean grade); the research-question item is included in points (it is the centre of the question lens) with grade 3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "@/lib/snapshot"; import { applyOverrides } from "@/lib/overrides";
const now = new Date("2026-11-02T00:00:00Z");
const item = (xId: string, extra: any = {}) => ({ xId, text: "t " + xId, createdAt: now, kind: "text", urls: [], media: [], isResearchQuestion: false, stage: "graded", fetchedAt: now, ...extra });
const layout: any = { version: 3, createdAt: now, method: "umap", status: "published", procrustesResidual: 0.02,
  points: [{ xId: "1", x: 0, y: 0, clusterId: 0, provisional: false }, { xId: "2", x: 1, y: 1, clusterId: 0, provisional: true }, { xId: "gone", x: 9, y: 9, clusterId: 1, provisional: false }],
  labels: [{ level: 1, text: "Leaf A", x: 0.5, y: 0.5, priority: 2, clusterId: 0 }], themes: [{ id: 0, label: "Theme", clusterIds: [0, 1] }],
  clusters: [{ id: 0, label: "Leaf A", themeId: 0, size: 2, x: 0.5, y: 0.5 }, { id: 1, label: "Leaf B", themeId: 0, size: 1, x: 9, y: 9 }], hulls: [] };
const enrichment = new Map([["1", { xId: "1", normalized: { title: "One", gist: "g1", tagsEn: ["a"], language: "en" } } as any]]);
const relations = new Map([["1", [{ xId: "1", questionId: "core", role: "evidence", grade: 3, rationale: "r", cosine: 0.4 }, { xId: "1", questionId: "seed-1", role: "evidence", grade: 3, rationale: "r", cosine: 0.3 }]]]);
const questions: any = [{ _id: "core", text: "Q", parentId: null }, { _id: "seed-1", text: "S", parentId: "core" }];

describe("buildSnapshot", () => {
  it("snapshot drops tombstoned items and aligns arrays", () => {
    const s = buildSnapshot({ layout, items: [item("1"), item("2"), item("gone", { deletedAt: now })], enrichment, relations, questions, overrides: [], generatedAt: now });
    expect(s.points.ids).toEqual(["1", "2"]); expect(s.points.x.length).toBe(2); expect(s.meta.title).toEqual(["One", "t 2"]);
    expect(s.points.grade).toEqual([3, 1]); expect(s.meta.role[1]).toBe("tangent"); expect(s.points.provisional).toEqual([0, 1]);
    expect(s.meta.subQuestions[0]).toEqual(["seed-1"]); expect(s.labels.questions.length).toBe(2);
  });
  it("emits theme, leaf and item labels with levels 0/1/2", () => {
    const s = buildSnapshot({ layout, items: [item("1"), item("2")], enrichment, relations, questions, overrides: [], generatedAt: now });
    const levels = new Set(s.labels.labels.map((l) => l.level)); expect(levels).toEqual(new Set([0, 1, 2]));
  });
  it("applyOverrides pins, renames, moves", () => {
    const l2 = applyOverrides(layout, [{ type: "pin", xId: "2", payload: { x: 5, y: 6 }, createdAt: now }, { type: "renameLabel", clusterId: 0, payload: { label: "Renamed" }, createdAt: now }, { type: "moveLeaf", xId: "1", payload: { clusterId: 1 }, createdAt: now }] as any);
    expect(l2.points.find((p) => p.xId === "2")).toMatchObject({ x: 5, y: 6 }); expect(l2.clusters[0].label).toBe("Renamed"); expect(l2.labels[0].text).toBe("Renamed"); expect(l2.points[0].clusterId).toBe(1);
    expect(layout.clusters[0].label).toBe("Leaf A"); // input not mutated
  });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// lib/overrides.ts
import type { Layout, Override } from "./types";
export function applyOverrides(layout: Layout, overrides: Override[]): Layout {
  const l: Layout = structuredClone(layout);
  for (const o of overrides) {
    if (o.type === "pin" && o.xId) { const p = l.points.find((p) => p.xId === o.xId); if (p) { p.x = Number(o.payload.x); p.y = Number(o.payload.y); } }
    if (o.type === "renameLabel" && o.clusterId !== undefined) { const label = String(o.payload.label); for (const c of l.clusters) if (c.id === o.clusterId) c.label = label; for (const lb of l.labels) if (lb.clusterId === o.clusterId && lb.level === 1) lb.text = label; }
    if (o.type === "moveLeaf" && o.xId) { const p = l.points.find((p) => p.xId === o.xId); if (p) p.clusterId = Number(o.payload.clusterId); }
  }
  return l;
}
// lib/snapshot.ts
import type { Enrichment, Item, Layout, Override, Question, Relation } from "./types"; import { applyOverrides } from "./overrides";
export const KINDS = ["text", "link", "media", "selfReply", "quote", "replyToOther", "retweet"] as const;
export function buildSnapshot(input: { layout: Layout; items: Item[]; enrichment: Map<string, Enrichment>; relations: Map<string, Relation[]>; questions: Question[]; overrides: Override[]; generatedAt: Date }) {
  const layout = applyOverrides(input.layout, input.overrides);
  const live = new Map(input.items.filter((i) => !i.deletedAt).map((i) => [i.xId, i]));
  const pts = layout.points.filter((p) => live.has(p.xId));
  const themeOfCluster = new Map<number, number>(); for (const t of layout.themes) for (const c of t.clusterIds) themeOfCluster.set(c, t.id);
  const points = { version: 1 as const, layoutVersion: layout.version, generatedAt: input.generatedAt.toISOString(), count: pts.length, ids: [] as string[], x: [] as number[], y: [] as number[], leaf: [] as number[], theme: [] as number[], grade: [] as number[], provisional: [] as number[], createdAt: [] as number[], kind: [] as number[],
    themes: layout.themes.map((t) => ({ id: t.id, label: t.label })), leaves: layout.clusters.map((c) => ({ id: c.id, label: c.label, themeId: c.themeId, x: c.x, y: c.y, size: c.size })), kinds: [...KINDS] };
  const meta = { version: 1 as const, ids: [] as string[], title: [] as string[], gist: [] as string[], url: [] as (string | null)[], domain: [] as (string | null)[], thumb: [] as (string | null)[], role: [] as string[], rationale: [] as string[], tags: [] as string[][], lang: [] as string[], subQuestions: [] as string[][] };
  const labels: LabelsFile["labels"] = [];
  const gradeSum = new Map<number, [number, number]>();
  for (const p of pts) {
    const it = live.get(p.xId)!; const en = input.enrichment.get(p.xId); const rels = input.relations.get(p.xId) ?? []; const core = rels.find((r) => r.questionId === "core");
    const grade = it.isResearchQuestion ? 3 : core?.grade ?? 1; const role = core?.role ?? "tangent";
    points.ids.push(p.xId); points.x.push(p.x); points.y.push(p.y); points.leaf.push(p.clusterId); points.theme.push(themeOfCluster.get(p.clusterId) ?? -1); points.grade.push(grade);
    points.provisional.push(p.provisional ? 1 : 0); points.createdAt.push(Math.floor(it.createdAt.getTime() / 1000)); points.kind.push(Math.max(0, KINDS.indexOf(it.kind)));
    const n = en?.normalized; const firstUrl = it.urls.find((u) => !u.isMedia);
    meta.ids.push(p.xId); meta.title.push(n?.title ?? en?.title ?? it.text.slice(0, 80)); meta.gist.push(n?.gist ?? it.text.slice(0, 280)); meta.url.push(firstUrl?.expandedUrl ?? null); meta.domain.push(firstUrl?.domain ?? null);
    meta.thumb.push(en?.thumbUrl ?? en?.ogImage ?? null); meta.role.push(role); meta.rationale.push(core?.rationale ?? ""); meta.tags.push(n?.tagsEn ?? []); meta.lang.push(n?.language ?? it.lang ?? "und"); meta.subQuestions.push(rels.filter((r) => r.questionId !== "core").map((r) => r.questionId));
    const gs = gradeSum.get(p.clusterId) ?? [0, 0]; gs[0] += grade; gs[1] += 1; gradeSum.set(p.clusterId, gs);
    labels.push({ x: p.x, y: p.y, content: meta.title[meta.title.length - 1], level: 2, priority: grade });
    if (en?.thumbUrl) labels.push({ x: p.x, y: p.y, content: { image: en.thumbUrl, width: 96, height: 64 }, level: 2, priority: grade + 0.5 });
  }
  for (const t of layout.themes) { const cs = layout.clusters.filter((c) => t.clusterIds.includes(c.id)); if (!cs.length) continue; const n = cs.reduce((a, c) => a + c.size, 0);
    labels.push({ x: cs.reduce((a, c) => a + c.x * c.size, 0) / n, y: cs.reduce((a, c) => a + c.y * c.size, 0) / n, content: t.label, level: 0, priority: 1000 + n }); }
  for (const c of layout.clusters) { const gs = gradeSum.get(c.id) ?? [0, 1]; labels.push({ x: c.x, y: c.y, content: c.label, level: 1, priority: 100 + c.size * (1 + gs[0] / Math.max(1, gs[1])) }); }
  const labelsFile: LabelsFile = { version: 1, labels, hulls: layout.hulls, questions: input.questions.filter((q) => !q.validTo).map((q) => ({ id: q._id, text: q.text, parentId: q.parentId })) };
  return { points, meta, labels: labelsFile };
}
export type PointsFile = ReturnType<typeof buildSnapshot>["points"]; export type MetaFile = ReturnType<typeof buildSnapshot>["meta"];
export interface LabelsFile { version: 1; labels: { x: number; y: number; content: string | { image: string; width: number; height: number }; level: number; priority: number }[]; hulls: { clusterId: number; polygon: [number, number][] }[]; questions: { id: string; text: string; parentId: string | null }[]; }
// lib/publish.ts
import type { Db } from "mongodb"; import { collections } from "./db"; import { buildSnapshot } from "./snapshot"; import { putPublic } from "./blob"; import { env } from "./env"; import type { Manifest } from "./types";
export async function publishSnapshot(db: Db, deps = { put: putPublic }): Promise<Manifest> {
  const c = collections(db);
  const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } }); if (!layout) throw new Error("no published layout");
  const [items, enr, rels, questions, overrides] = await Promise.all([c.items.find({ kind: { $nin: ["replyToOther", "retweet"] } }).toArray(), c.enrichment.find({}).toArray(), c.relations.find({}).toArray(), c.questions.find({}).toArray(), c.overrides.find({}).toArray()]);
  const relMap = new Map<string, typeof rels>(); for (const r of rels) relMap.set(r.xId, [...(relMap.get(r.xId) ?? []), r]);
  const generatedAt = new Date(); const snap = buildSnapshot({ layout, items, enrichment: new Map(enr.map((e) => [e.xId, e])), relations: relMap, questions, overrides, generatedAt });
  const dir = `canvas/${generatedAt.toISOString().replace(/[:.]/g, "-")}`;
  const [pointsUrl, metaUrl, labelsUrl] = await Promise.all([deps.put(`${dir}/points.json`, JSON.stringify(snap.points), "application/json"), deps.put(`${dir}/meta.json`, JSON.stringify(snap.meta), "application/json"), deps.put(`${dir}/labels.json`, JSON.stringify(snap.labels), "application/json")]);
  const manifest: Manifest = { _id: "current", layoutVersion: layout.version, pointsUrl, metaUrl, labelsUrl, generatedAt, count: snap.points.count, embeddingModel: `${env().EMBEDDING_MODEL}@${env().EMBEDDING_DIMS}` };
  await c.manifest.replaceOne({ _id: "current" }, manifest, { upsert: true });
  return manifest;
}
```

- [ ] **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** — `git add lib/snapshot.ts lib/overrides.ts lib/publish.ts tests/unit/snapshot.test.ts && git commit -m "feat: columnar snapshot builder, overrides, publish to blob"`

### Task 14: Pipeline stages and the idempotent runner

**Files:**
- Create: `lib/pipeline/stages.ts`, `lib/pipeline/run.ts`, `tests/unit/stages.test.ts`, `tests/integration/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–13.
- Produces:
```ts
// lib/pipeline/stages.ts — each stage advances items whose `stage` equals its input stage; all idempotent; each returns counts
export interface StageDeps { db: Db; fetchImpl: typeof fetch; enrichUrl: typeof enrichUrl; describeImage: typeof describeImage; normalizeItem: typeof normalizeItem; embedTexts: typeof embedTexts; gradeItem: typeof gradeItem; placeItem: typeof placeItem; now: () => Date; log: (s: string) => void; }
export function defaultDeps(db: Db): StageDeps;
export async function stageEnrich(d: StageDeps, limit: number): Promise<{ done: number; deferred: number; errors: number }>;
export async function stageNormalize(d: StageDeps, limit: number): Promise<{ done: number; empty: number; errors: number }>;
export async function stageEmbed(d: StageDeps, limit: number): Promise<{ done: number }>;
export async function stagePlace(d: StageDeps, limit: number): Promise<{ done: number; skippedNoLayout: boolean }>;
export async function stageGrade(d: StageDeps, limit: number): Promise<{ done: number }>;
export function nextStage(s: Stage): Stage | null;
// lib/pipeline/run.ts
export async function ingestNew(db: Db, deps: { fetchNewPosts: typeof fetchNewPosts; now: () => Date }): Promise<{ inserted: number; requests: number; newestId?: string }>;
export async function runDaily(db: Db, deps: Partial<StageDeps> & { fetchNewPosts?: typeof fetchNewPosts; publish?: typeof publishSnapshot; budgetMs?: number }): Promise<RunDoc>;
```
- Stage rules:
  - `enrich`: for `kind ∈ {link, quote, text, selfReply}` take the first non-media URL → `enrichUrl`; for `media` take `media[0].url ?? previewUrl` → `describeImage`; store `enrichment` upsert; `deferred` ⇒ stage stays `ingested` and the run notes it; `replyToOther`/`retweet` skip straight to stage `graded` with no enrichment (excluded from the canvas; they are kept for completeness). Empty-URL text posts get `{source:"none"}`.
  - `normalize`: parent = `items.findOne({xId: parentId})` (may be null); `null` result ⇒ `needsContent: true`, stage advances to `graded` (never embedded, never placed) — such items are not in the canvas until content arrives (owner can add alt text later and reset `stage`).
  - `embed`: `inputHash = sha256(model|dims|input)`; skip API if an existing vector has the same hash.
  - `place`: requires a `published` layout; if none ⇒ return `{ skippedNoLayout: true }` and leave stage `embedded`. Otherwise `placeItem`, push the point into the **current published layout document** (`$push: { points }`) so the layout is the single source of truth, and set stage `placed`. Items that already have a point in the layout (bootstrap case) just advance.
  - `grade`: skip the research-question item (advance only); `relations` upsert by `(xId, questionId)`; stage `graded`.
  - `runDaily`: open a `runs` doc; `ingestNew` with watermark = max `items.xId` as BigInt (string compare is unsafe for different lengths — compare as BigInt); then stages in order with a soft time budget (`budgetMs` default 240 000; check between items); if any item changed stage or `force` ⇒ `publishSnapshot`; if a published layout exists compute provisional share and when `> RELAYOUT_PROVISIONAL_THRESHOLD` note `relayoutRecommended` (Task 15 triggers the batch); close the run with counts; never throw — errors go into `runs.errors` and `ok=false`.

- [ ] **Step 1: Write the failing unit tests (stage logic with an in-memory fake db)**

`tests/unit/stages.test.ts` — use a tiny fake implementing the handful of collection methods used (`find().toArray()`, `findOne`, `updateOne`, `countDocuments`); assert:
```ts
import { describe, it, expect } from "vitest";
import { nextStage } from "@/lib/pipeline/stages";
describe("stage order", () => {
  it("advances in the spec order and terminates", () => {
    const order: string[] = []; let s: any = "ingested"; while (s) { order.push(s); s = nextStage(s); }
    expect(order).toEqual(["ingested", "enriched", "normalized", "embedded", "placed", "graded"]);
  });
});
```
(The behavioural assertions for stages live in the integration test below, against a real database, because the stages are thin glue over MongoDB queries; unit-testing them against a fake would test the fake.)

- [ ] **Step 2: Write the failing integration test** (skipped without `MONGODB_URI_TEST`)

`tests/integration/run.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
const uri = process.env.MONGODB_URI_TEST; const d = uri ? describe : describe.skip;

d("runDaily", () => {
  let db: any, mod: typeof import("@/lib/pipeline/run"), dbmod: typeof import("@/lib/db");
  const payload = JSON.parse(fs.readFileSync("tests/fixtures/timeline-sample.json", "utf8"));
  const fakeDeps = () => ({
    fetchNewPosts: async () => ({ payload, requests: 1 }),
    fetchImpl: (async () => new Response("{}", { status: 500 })) as any,
    enrichUrl: async (url: string) => ({ source: "thin" as const, title: url, thin: true }),
    describeImage: async () => ({ vision: { transcript: "OCR TEXT", kind: "screenshot_text", description: "d", title: "t" }, thumbUrl: "https://b/t.jpg", originalMediaUrl: "https://b/o.jpg" }),
    normalizeItem: async (item: any, enrich: any) => (item.text.replace(/https?:\/\/\S+/g, "").trim() || enrich.transcript || enrich.title) ? { title: "T " + item.xId, summaryEn: "S", gist: "G", tagsEn: ["x"], language: "en", entities: [], contentKind: "thought" } : null,
    embedTexts: async (t: string[]) => t.map((_, i) => [1, i % 3, 0]),
    gradeItem: async (item: any) => ({ relations: [{ xId: item.xId, questionId: "core", role: "example", grade: 2, rationale: "r", cosine: 0.2, modelVersion: "m", disagreement: false }], cosineToCore: 0.2 }),
    placeItem: async (_db: any, xId: string) => ({ xId, x: 1, y: 1, clusterId: 0, provisional: true }),
    publish: async () => ({ _id: "current", layoutVersion: 1, pointsUrl: "p", metaUrl: "m", labelsUrl: "l", generatedAt: new Date(), count: 1, embeddingModel: "e" }),
  });
  beforeAll(async () => { process.env.MONGODB_URI = uri!; process.env.MONGODB_DB = "research_map_test_run"; process.env.OPENAI_API_KEY = "x";
    dbmod = await import("@/lib/db"); mod = await import("@/lib/pipeline/run"); db = await dbmod.getDb(); await db.dropDatabase(); await dbmod.ensureIndexes(db);
    await dbmod.collections(db).questions.insertOne({ _id: "core", text: "Q", parentId: null, embedding: [1, 0, 0], validFrom: new Date(), validTo: null, origin: "seed" } as any); });
  afterAll(async () => { await db.dropDatabase(); await dbmod.closeDb(); });

  it("run without published layout skips placement and still succeeds", async () => {
    const run = await mod.runDaily(db, fakeDeps() as any);
    expect(run.ok).toBe(true); expect(run.counts.ingested).toBe(payload.data.length);
    const { items } = dbmod.collections(db);
    expect(await items.countDocuments({ stage: "embedded" })).toBeGreaterThan(0);
    expect(await items.countDocuments({ stage: "placed" })).toBe(0);
    expect(run.notes.join(" ")).toMatch(/no published layout/i);
  });
  it("is idempotent: a second run ingests nothing new and changes nothing", async () => {
    const before = await dbmod.collections(db).items.find({}, { projection: { xId: 1, stage: 1 } }).toArray();
    const run = await mod.runDaily(db, { ...fakeDeps(), fetchNewPosts: async () => ({ payload: { data: [] }, requests: 1 }) } as any);
    expect(run.counts.ingested).toBe(0);
    const after = await dbmod.collections(db).items.find({}, { projection: { xId: 1, stage: 1 } }).toArray(); expect(after).toEqual(before);
  });
  it("places and grades once a published layout exists", async () => {
    const { layouts, items } = dbmod.collections(db);
    await layouts.insertOne({ version: 1, createdAt: new Date(), method: "test", status: "published", points: [], labels: [], themes: [], clusters: [], hulls: [], procrustesResidual: 0 } as any);
    const run = await mod.runDaily(db, { ...fakeDeps(), fetchNewPosts: async () => ({ payload: { data: [] }, requests: 1 }) } as any);
    expect(run.ok).toBe(true); expect(await items.countDocuments({ stage: "embedded" })).toBe(0);
    const graded = await items.countDocuments({ stage: "graded", kind: { $nin: ["replyToOther", "retweet"] } }); expect(graded).toBeGreaterThan(0);
    const l = await layouts.findOne({ version: 1 }); expect(l!.points.length).toBe(await items.countDocuments({ stage: "graded", kind: { $nin: ["replyToOther", "retweet"] }, "enrichment.needsContent": { $ne: true } }) - 0 /* photo-only items with OCR text are placed too */);
  });
  it("excludes replies to others and retweets from enrichment", async () => {
    const { enrichment, items } = dbmod.collections(db);
    const ro = await items.find({ kind: { $in: ["replyToOther", "retweet"] } }).toArray();
    expect(ro.length).toBeGreaterThan(0); expect(ro.every((i) => i.stage === "graded")).toBe(true);
    expect(await enrichment.countDocuments({ xId: { $in: ro.map((i) => i.xId) } })).toBe(0);
  });
  it("watermark is the numerically largest xId", async () => {
    const w = await mod.watermark(db); const ids = payload.data.map((t: any) => BigInt(t.id)); expect(BigInt(w!)).toBe(ids.reduce((a: bigint, b: bigint) => (a > b ? a : b)));
  });
});
```
(The `l!.points.length` assertion is simpler to state as: equals the number of items at stage `graded` that have a vector — use `vectors.countDocuments({})` instead; implement that form.)

- [ ] **Step 3: Run** → FAIL

- [ ] **Step 4: Write `lib/pipeline/stages.ts`**

```ts
import type { Db } from "mongodb"; import { collections } from "../db"; import type { Item, Stage } from "../types";
import { enrichUrl } from "../enrich/ladder"; import { describeImage } from "../enrich/vision"; import { normalizeItem } from "../llm/normalize"; import { embedTexts, embeddingInput } from "../llm/embed";
import { gradeItem } from "../llm/grade"; import { placeItem } from "../place"; import { sha256 } from "../hash"; import { env } from "../env";

export interface StageDeps { db: Db; fetchImpl: typeof fetch; enrichUrl: typeof enrichUrl; describeImage: typeof describeImage; normalizeItem: typeof normalizeItem; embedTexts: typeof embedTexts; gradeItem: typeof gradeItem; placeItem: typeof placeItem; now: () => Date; log: (s: string) => void; }
export const defaultDeps = (db: Db): StageDeps => ({ db, fetchImpl: fetch, enrichUrl, describeImage, normalizeItem, embedTexts, gradeItem, placeItem, now: () => new Date(), log: console.log });
const ORDER: Stage[] = ["ingested", "enriched", "normalized", "embedded", "placed", "graded"];
export const nextStage = (s: Stage): Stage | null => ORDER[ORDER.indexOf(s) + 1] ?? null;
const EXCLUDED = ["replyToOther", "retweet"] as const;
const UA = "research.nalenz.org/1.0 (https://github.com/hermesloom/research-map)";

export async function stageEnrich(d: StageDeps, limit: number) {
  const c = collections(d.db); const out = { done: 0, deferred: 0, errors: 0 };
  await c.items.updateMany({ stage: "ingested", kind: { $in: [...EXCLUDED] } }, { $set: { stage: "graded" } });
  const todo = await c.items.find({ stage: "ingested" }).sort({ createdAt: 1 }).limit(limit).toArray();
  for (const it of todo) {
    try {
      let doc: Record<string, unknown> = { xId: it.xId, source: "none", thin: true, needsContent: false, fetchedAt: d.now() };
      const url = it.urls.find((u) => !u.isMedia)?.expandedUrl; const img = it.media.find((m) => m.type === "photo")?.url ?? it.media[0]?.previewUrl;
      if (url) { const f = await d.enrichUrl(url, { fetchImpl: d.fetchImpl, firecrawlKey: env().FIRECRAWL_API_KEY, userAgent: UA });
        if ((f as any).deferred) { out.deferred++; continue; }
        doc = { ...doc, source: f.source, title: f.title, excerpt: f.excerpt, ogImage: f.ogImage, thin: f.thin }; }
      if (img) { const v = await d.describeImage(img); doc = { ...doc, transcript: v.vision.transcript, imageDescription: v.vision.description, title: (doc.title as string) ?? v.vision.title, thumbUrl: v.thumbUrl, originalMediaUrl: v.originalMediaUrl, thin: false }; }
      await c.enrichment.updateOne({ xId: it.xId }, { $set: doc }, { upsert: true });
      await c.items.updateOne({ xId: it.xId }, { $set: { stage: "enriched" }, $unset: { stageError: "" } }); out.done++;
    } catch (e) { out.errors++; await c.items.updateOne({ xId: it.xId }, { $set: { stageError: `enrich: ${String(e).slice(0, 300)}` } }); }
  }
  return out;
}
export async function stageNormalize(d: StageDeps, limit: number) {
  const c = collections(d.db); const out = { done: 0, empty: 0, errors: 0 };
  const todo = await c.items.find({ stage: "enriched" }).sort({ createdAt: 1 }).limit(limit).toArray();
  for (const it of todo) {
    try {
      const en = (await c.enrichment.findOne({ xId: it.xId })) ?? {}; const parent = it.parentId ? await c.items.findOne({ xId: it.parentId }) : null;
      const n = await d.normalizeItem(it, en as any, parent);
      if (!n) { out.empty++; await c.enrichment.updateOne({ xId: it.xId }, { $set: { needsContent: true } }, { upsert: true }); await c.items.updateOne({ xId: it.xId }, { $set: { stage: "graded" } }); continue; }
      await c.enrichment.updateOne({ xId: it.xId }, { $set: { normalized: n, needsContent: false } }, { upsert: true });
      await c.items.updateOne({ xId: it.xId }, { $set: { stage: "normalized" }, $unset: { stageError: "" } }); out.done++;
    } catch (e) { out.errors++; await c.items.updateOne({ xId: it.xId }, { $set: { stageError: `normalize: ${String(e).slice(0, 300)}` } }); }
  }
  return out;
}
export async function stageEmbed(d: StageDeps, limit: number) {
  const c = collections(d.db); const todo = await c.items.find({ stage: "normalized" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  const ens = new Map((await c.enrichment.find({ xId: { $in: todo.map((t) => t.xId) } }).toArray()).map((e) => [e.xId, e]));
  const model = env().EMBEDDING_MODEL, dims = env().EMBEDDING_DIMS;
  const work = todo.map((it) => { const n = ens.get(it.xId)?.normalized!; const input = embeddingInput(n); return { it, input, hash: sha256(`${model}|${dims}|${input}`) }; });
  const existing = new Map((await c.vectors.find({ xId: { $in: work.map((w) => w.it.xId) } }).toArray()).map((v) => [v.xId, v.inputHash]));
  const need = work.filter((w) => existing.get(w.it.xId) !== w.hash);
  const vecs = need.length ? await d.embedTexts(need.map((w) => w.input)) : [];
  for (let i = 0; i < need.length; i++) await c.vectors.updateOne({ xId: need[i].it.xId }, { $set: { embedding: vecs[i], model, dims, inputHash: need[i].hash } }, { upsert: true });
  for (const w of work) { await c.items.updateOne({ xId: w.it.xId }, { $set: { stage: "embedded" } }); done++; }
  return { done };
}
export async function stagePlace(d: StageDeps, limit: number) {
  const c = collections(d.db); const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } });
  if (!layout) return { done: 0, skippedNoLayout: true };
  const todo = await c.items.find({ stage: "embedded" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  const have = new Set(layout.points.map((p) => p.xId));
  for (const it of todo) {
    if (!have.has(it.xId)) {
      if (layout.points.length === 0) break; // nothing to snap to; wait for the batch job
      const v = await c.vectors.findOne({ xId: it.xId }); if (!v) continue;
      const p = await d.placeItem(d.db, it.xId, v.embedding, layout); await c.layouts.updateOne({ version: layout.version }, { $push: { points: p } }); layout.points.push(p);
    }
    await c.items.updateOne({ xId: it.xId }, { $set: { stage: "placed" } }); done++;
  }
  return { done, skippedNoLayout: false };
}
export async function stageGrade(d: StageDeps, limit: number) {
  const c = collections(d.db); const questions = await c.questions.find({ validTo: null }).toArray();
  const todo = await c.items.find({ stage: "placed" }).sort({ createdAt: 1 }).limit(limit).toArray(); let done = 0;
  for (const it of todo) {
    if (!it.isResearchQuestion) {
      const en = await c.enrichment.findOne({ xId: it.xId }); const v = await c.vectors.findOne({ xId: it.xId });
      if (en?.normalized && v) { const { relations } = await d.gradeItem(it, en.normalized, v.embedding, questions);
        for (const r of relations) await c.relations.updateOne({ xId: r.xId, questionId: r.questionId }, { $set: r }, { upsert: true }); }
    }
    await c.items.updateOne({ xId: it.xId }, { $set: { stage: "graded" } }); done++;
  }
  return { done };
}
```

- [ ] **Step 5: Write `lib/pipeline/run.ts`**

```ts
import type { Db } from "mongodb"; import { collections } from "../db"; import { parseTimeline } from "../x/parse"; import { fetchNewPosts } from "../x/client"; import { publishSnapshot } from "../publish"; import { env } from "../env";
import { defaultDeps, stageEnrich, stageNormalize, stageEmbed, stagePlace, stageGrade, type StageDeps } from "./stages"; import type { RunDoc } from "../types";

export async function watermark(db: Db): Promise<string | undefined> {
  const ids = await collections(db).items.find({}, { projection: { xId: 1 } }).toArray(); if (!ids.length) return undefined;
  return ids.map((d) => BigInt(d.xId)).reduce((a, b) => (a > b ? a : b)).toString();
}
export async function ingestNew(db: Db, deps: { fetchNewPosts: typeof fetchNewPosts; now: () => Date }, opts: { sinceId?: string; startTime?: string } = {}) {
  const c = collections(db); const sinceId = opts.sinceId ?? (await watermark(db));
  if (!sinceId && !opts.startTime) return { inserted: 0, requests: 0 }; // never sweep an empty DB from the cron; bootstrap handles that
  const { payload, requests } = await deps.fetchNewPosts({ sinceId, startTime: opts.startTime });
  const items = parseTimeline(payload, env().X_USER_ID, env().RESEARCH_QUESTION_POST_ID); let inserted = 0;
  for (const it of items) { const r = await c.items.updateOne({ xId: it.xId }, { $setOnInsert: it }, { upsert: true }); if (r.upsertedCount) inserted++; }
  return { inserted, requests, newestId: payload.meta?.newest_id };
}
export async function runDaily(db: Db, deps: Partial<StageDeps> & { fetchNewPosts?: typeof fetchNewPosts; publish?: typeof publishSnapshot; budgetMs?: number; force?: boolean } = {}): Promise<RunDoc> {
  const d: StageDeps = { ...defaultDeps(db), ...deps }; const c = collections(db); const started = d.now(); const budget = deps.budgetMs ?? 240_000;
  const run: RunDoc = { startedAt: started, kind: "daily", counts: {}, errors: [], notes: [], ok: true };
  const { insertedId } = await c.runs.insertOne(run); const timeLeft = () => budget - (Date.now() - started.getTime());
  try {
    const ing = await ingestNew(db, { fetchNewPosts: deps.fetchNewPosts ?? fetchNewPosts, now: d.now }); run.counts.ingested = ing.inserted; run.counts.xRequests = ing.requests;
    let changed = ing.inserted > 0;
    const steps: Array<[string, () => Promise<any>]> = [["enrich", () => stageEnrich(d, 200)], ["normalize", () => stageNormalize(d, 300)], ["embed", () => stageEmbed(d, 500)], ["place", () => stagePlace(d, 500)], ["grade", () => stageGrade(d, 300)]];
    for (const [name, fn] of steps) { if (timeLeft() < 20_000) { run.notes.push(`budget exhausted before ${name}`); break; }
      const r = await fn(); run.counts[name] = r.done ?? 0; if (r.done) changed = true; if (r.deferred) run.notes.push(`${r.deferred} enrichments deferred (firecrawl quota)`); if (r.errors) run.errors.push(`${name}: ${r.errors} item errors`); if (r.skippedNoLayout) run.notes.push("no published layout yet; placement skipped"); }
    const layout = await c.layouts.findOne({ status: "published" }, { sort: { version: -1 } });
    if (layout?.points.length) { const prov = layout.points.filter((p) => p.provisional).length / layout.points.length; run.counts.provisionalPermille = Math.round(prov * 1000); if (prov > env().RELAYOUT_PROVISIONAL_THRESHOLD) run.notes.push("relayoutRecommended"); }
    if ((changed || deps.force) && layout) { const m = await (deps.publish ?? publishSnapshot)(db); run.counts.published = m.count; }
  } catch (e) { run.ok = false; run.errors.push(String(e).slice(0, 500)); }
  run.finishedAt = d.now(); await c.runs.replaceOne({ _id: insertedId }, run); return run;
}
```

- [ ] **Step 6: Run unit + integration** → PASS
- [ ] **Step 7: Commit** — `git add lib/pipeline tests/unit/stages.test.ts tests/integration/run.test.ts && git commit -m "feat: idempotent stage pipeline and daily runner"`

### Task 15: HTTP routes, cron config, reconciliation, batch trigger

**Files:**
- Create: `app/api/cron/ingest/route.ts`, `app/api/status/route.ts`, `app/api/manifest/route.ts`, `app/api/posts/route.ts`, `app/api/search/route.ts`, `lib/pipeline/reconcile.ts`, `scripts/trigger-batch.ts`, `vercel.ts`, `tests/unit/routes.test.ts`

**Interfaces:**
- `GET /api/cron/ingest` — requires `Authorization: Bearer ${CRON_SECRET}`; `export const dynamic = "force-dynamic"; export const maxDuration = 300;` runs `runDaily`; on Sundays (UTC) also `reconcileDeletions`; if the run notes contain `relayoutRecommended` and `GITHUB_DISPATCH_TOKEN` is set, POST `repository_dispatch` `{ event_type: "relayout" }` to `https://api.github.com/repos/${GITHUB_REPO}/dispatches`; returns the run JSON.
- `GET /api/status` — last 5 runs (without errors' stack), manifest summary; `Cache-Control: no-store`.
- `GET /api/manifest` — the manifest doc; headers `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400`.
- `GET /api/posts?since=<iso>` — ids + minimal fields of items `fetchedAt > since` and `stage == graded` (for the "what's new" badge), same caching.
- `GET /api/search?q=` — embeds `q`, `$vectorSearch exact:true limit 20` excluding the research-question item, returns `[{xId, score}]`; `s-maxage=3600`.
- `lib/pipeline/reconcile.ts`: `reconcileDeletions(db, deps)` — `fetchNewPosts({ startTime: <now-14d ISO> })`, set `deletedAt` on items with `createdAt > now-14d` not in the response (and not already deleted); clears `deletedAt` if a post reappears; returns counts; records a `runs` doc with `kind: "reconcile"`.
- `vercel.ts`: `crons: [{ path: "/api/cron/ingest", schedule: "0 4 * * *" }]`, `framework: "nextjs"`.
- `scripts/trigger-batch.ts`: local helper doing the same repository_dispatch POST.

- [ ] **Step 1: Write the failing tests**

`tests/unit/routes.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; process.env.CRON_SECRET = "s3cret"; vi.resetModules(); });

describe("cron route auth", () => {
  it("rejects missing or wrong bearer", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}) })); vi.doMock("@/lib/pipeline/run", () => ({ runDaily: async () => ({ ok: true }) }));
    const { GET } = await import("@/app/api/cron/ingest/route");
    expect((await GET(new Request("http://x/api/cron/ingest"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/ingest", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
  it("runs with the right bearer and returns the run", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}) })); vi.doMock("@/lib/pipeline/run", () => ({ runDaily: async () => ({ ok: true, notes: [], counts: { ingested: 2 } }) })); vi.doMock("@/lib/pipeline/reconcile", () => ({ reconcileDeletions: async () => ({}) }));
    const { GET } = await import("@/app/api/cron/ingest/route");
    const res = await GET(new Request("http://x/api/cron/ingest", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200); expect((await res.json()).counts.ingested).toBe(2);
  });
});
describe("manifest route caching", () => {
  it("sets s-maxage and swr", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ manifest: { findOne: async () => ({ _id: "current", count: 1 }) } }) }));
    const { GET } = await import("@/app/api/manifest/route"); const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/); expect(res.headers.get("cache-control")).toMatch(/stale-while-revalidate/);
  });
});
describe("reconcile", () => {
  it("tombstones items missing from the 14-day window and revives reappearing ones", async () => {
    const { diffDeletions } = await import("@/lib/pipeline/reconcile");
    const now = new Date("2026-11-08T00:00:00Z"); const recent = new Date("2026-11-01T00:00:00Z"); const old = new Date("2026-09-01T00:00:00Z");
    const local = [{ xId: "1", createdAt: recent }, { xId: "2", createdAt: recent, deletedAt: now }, { xId: "3", createdAt: old }];
    const r = diffDeletions(local as any, ["2"], now);
    expect(r.toDelete).toEqual(["1"]); expect(r.toRevive).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement routes and helpers**

```ts
// app/api/cron/ingest/route.ts
import { getDb } from "@/lib/db"; import { runDaily } from "@/lib/pipeline/run"; import { reconcileDeletions } from "@/lib/pipeline/reconcile"; import { env } from "@/lib/env";
export const dynamic = "force-dynamic"; export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET; const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const db = await getDb(); const run = await runDaily(db, {});
  if (new Date().getUTCDay() === 0) { try { await reconcileDeletions(db, {}); } catch (e) { run.notes.push(`reconcile failed: ${String(e).slice(0, 200)}`); } }
  if (run.notes.includes("relayoutRecommended") && process.env.GITHUB_DISPATCH_TOKEN) {
    await fetch(`https://api.github.com/repos/${env().GITHUB_REPO}/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "research-map" }, body: JSON.stringify({ event_type: "relayout" }) }).catch(() => {});
  }
  return Response.json(run, { status: run.ok ? 200 : 500 });
}
// app/api/manifest/route.ts
import { getDb, collections } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() { const db = await getDb(); const m = await collections(db).manifest.findOne({ _id: "current" });
  return Response.json(m ?? { error: "no snapshot yet" }, { status: m ? 200 : 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } }); }
// app/api/status/route.ts
import { getDb, collections } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() { const db = await getDb(); const c = collections(db);
  const [runs, manifest, stages] = await Promise.all([c.runs.find({}).sort({ startedAt: -1 }).limit(5).toArray(), c.manifest.findOne({ _id: "current" }), c.items.aggregate([{ $group: { _id: "$stage", n: { $sum: 1 } } }]).toArray()]);
  return Response.json({ runs, manifest, stages }, { headers: { "Cache-Control": "no-store" } }); }
// app/api/posts/route.ts
import { getDb, collections } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const since = new URL(request.url).searchParams.get("since"); const db = await getDb();
  const q: any = { stage: "graded", kind: { $nin: ["replyToOther", "retweet"] } }; if (since) q.fetchedAt = { $gt: new Date(since) };
  const rows = await collections(db).items.find(q, { projection: { _id: 0, xId: 1, createdAt: 1, fetchedAt: 1, kind: 1 } }).sort({ createdAt: -1 }).limit(200).toArray();
  return Response.json(rows, { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } }); }
// app/api/search/route.ts
import { getDb } from "@/lib/db"; import { embedTexts } from "@/lib/llm/embed"; import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 300); if (!q) return Response.json([]);
  const [v] = await embedTexts([q]); const db = await getDb();
  const rows = await db.collection("vectors").aggregate([{ $vectorSearch: { index: "embedding_idx", path: "embedding", queryVector: v, exact: true, limit: 21 } }, { $project: { _id: 0, xId: 1, score: { $meta: "vectorSearchScore" } } }]).toArray();
  return Response.json(rows.filter((r) => r.xId !== env().RESEARCH_QUESTION_POST_ID).slice(0, 20), { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" } }); }
// lib/pipeline/reconcile.ts
import type { Db } from "mongodb"; import { collections } from "../db"; import { fetchNewPosts } from "../x/client";
export function diffDeletions(local: { xId: string; createdAt: Date; deletedAt?: Date }[], remoteIds: string[], now: Date, days = 14) {
  const cutoff = new Date(now.getTime() - days * 86400_000); const remote = new Set(remoteIds);
  const window = local.filter((i) => i.createdAt > cutoff);
  return { toDelete: window.filter((i) => !i.deletedAt && !remote.has(i.xId)).map((i) => i.xId), toRevive: window.filter((i) => i.deletedAt && remote.has(i.xId)).map((i) => i.xId) };
}
export async function reconcileDeletions(db: Db, deps: { fetchNewPosts?: typeof fetchNewPosts; now?: () => Date }) {
  const c = collections(db); const now = (deps.now ?? (() => new Date()))(); const startTime = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const { payload, requests } = await (deps.fetchNewPosts ?? fetchNewPosts)({ startTime });
  const local = await c.items.find({ createdAt: { $gt: new Date(startTime) } }, { projection: { xId: 1, createdAt: 1, deletedAt: 1 } }).toArray();
  const r = diffDeletions(local as any, (payload.data ?? []).map((t) => t.id), now);
  if (r.toDelete.length) await c.items.updateMany({ xId: { $in: r.toDelete } }, { $set: { deletedAt: now } });
  if (r.toRevive.length) await c.items.updateMany({ xId: { $in: r.toRevive } }, { $unset: { deletedAt: "" } });
  await c.runs.insertOne({ startedAt: now, finishedAt: new Date(), kind: "reconcile", counts: { requests, deleted: r.toDelete.length, revived: r.toRevive.length }, errors: [], notes: [], ok: true });
  return r;
}
```
`vercel.ts`:
```ts
import type { VercelConfig } from "@vercel/config/v1";
export const config: VercelConfig = { framework: "nextjs", crons: [{ path: "/api/cron/ingest", schedule: "0 4 * * *" }] };
```

- [ ] **Step 4: Run** → PASS; `pnpm typecheck && pnpm build`.
- [ ] **Step 5: Commit** — `git add app/api lib/pipeline/reconcile.ts scripts/trigger-batch.ts vercel.ts tests/unit/routes.test.ts && git commit -m "feat: cron, status, manifest, posts, search routes; deletion reconciliation"`

### Task 16: Backlog bootstrap script

**Files:**
- Create: `scripts/bootstrap.ts`, `tests/unit/bootstrap.test.ts`

**Interfaces:**
- Consumes: `parseTimeline`, `collections`, stage functions, `ensureIndexes`, `ensureVectorIndex`.
- Produces: CLI `pnpm bootstrap --file ~/x-nalenz-data/timeline-2026-11-01.json [--stage enrich|normalize|embed|all] [--limit N] [--concurrency 4]`. Loads the saved export (the file has `{tweets, includes}` — adapt via `toPayload(file) → XTimelinePayload`), upserts all items, then loops `stageEnrich → stageNormalize → stageEmbed` until no progress (placement and grading happen after the first batch layout: `--stage grade` later runs `stagePlace`+`stageGrade`). Writes a `runs` doc with `kind: "bootstrap"`. Prints per-stage counts and a Firecrawl credit estimate before starting (`generic`-host URL count) and asks for `--yes` to proceed when the estimate exceeds 900.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toPayload, estimateFirecrawlCredits } from "@/scripts/bootstrap-lib";
describe("bootstrap helpers", () => {
  it("adapts the export file shape to an API payload", () => {
    const p = toPayload({ tweets: [{ id: "1", text: "x", created_at: "2026-01-01T00:00:00Z" }], includes: { media: [{ media_key: "m", type: "photo" }], tweets: [], users: [] } });
    expect(p.data!.length).toBe(1); expect(p.includes!.media!.length).toBe(1);
  });
  it("counts only generic-host, non-media, first URLs for the credit estimate", () => {
    const items: any = [{ kind: "link", urls: [{ expandedUrl: "https://xtdb.com/", isMedia: false }] }, { kind: "link", urls: [{ expandedUrl: "https://en.wikipedia.org/wiki/A", isMedia: false }] }, { kind: "media", urls: [{ expandedUrl: "https://x.com/u/status/1/photo/1", isMedia: true }] }, { kind: "replyToOther", urls: [{ expandedUrl: "https://foo.org", isMedia: false }] }];
    expect(estimateFirecrawlCredits(items)).toBe(1);
  });
});
```
Put the pure helpers in `scripts/bootstrap-lib.ts` so the CLI file (`scripts/bootstrap.ts`) stays side-effect-only.

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// scripts/bootstrap-lib.ts
import type { XTimelinePayload } from "@/lib/x/parse"; import { routeHost } from "@/lib/enrich/router"; import type { Item } from "@/lib/types";
export function toPayload(file: { tweets: any[]; includes?: { media?: any[] } }): XTimelinePayload { return { data: file.tweets, includes: { media: file.includes?.media ?? [] } }; }
export function estimateFirecrawlCredits(items: Pick<Item, "kind" | "urls">[]): number {
  return items.filter((i) => !["replyToOther", "retweet", "media"].includes(i.kind)).map((i) => i.urls.find((u) => !u.isMedia)?.expandedUrl).filter((u): u is string => !!u).filter((u) => routeHost(u) === "generic").length;
}
// scripts/bootstrap.ts
import fs from "node:fs"; import { parseArgs } from "node:util"; import { loadEnv, env } from "@/lib/env"; import { getDb, collections, ensureIndexes, ensureVectorIndex, closeDb } from "@/lib/db";
import { parseTimeline } from "@/lib/x/parse"; import { defaultDeps, stageEnrich, stageNormalize, stageEmbed, stagePlace, stageGrade } from "@/lib/pipeline/stages"; import { toPayload, estimateFirecrawlCredits } from "./bootstrap-lib";
const { values } = parseArgs({ options: { file: { type: "string" }, stage: { type: "string", default: "all" }, limit: { type: "string", default: "100000" }, yes: { type: "boolean", default: false } } });
loadEnv(); const db = await getDb(); await ensureIndexes(db); await ensureVectorIndex(db, env().EMBEDDING_DIMS); const c = collections(db); const d = defaultDeps(db); const limit = Number(values.limit);
const run = { startedAt: new Date(), kind: "bootstrap" as const, counts: {} as Record<string, number>, errors: [] as string[], notes: [] as string[], ok: true };
if (values.file) { const items = parseTimeline(toPayload(JSON.parse(fs.readFileSync(values.file, "utf8"))), env().X_USER_ID, env().RESEARCH_QUESTION_POST_ID); let ins = 0;
  for (const it of items) { const r = await c.items.updateOne({ xId: it.xId }, { $setOnInsert: it }, { upsert: true }); ins += r.upsertedCount; }
  run.counts.inserted = ins; const est = estimateFirecrawlCredits(items); console.log(`inserted ${ins}/${items.length}; firecrawl credit estimate ≈ ${est}`);
  if (est > 900 && !values.yes) { console.log("Estimate exceeds 900 credits; re-run with --yes or split with --limit."); process.exit(2); } }
const loop = async (name: string, fn: () => Promise<{ done: number }>) => { let total = 0; for (;;) { const r = await fn(); total += r.done; console.log(name, r); if (!r.done) break; } run.counts[name] = total; };
const s = values.stage;
if (s === "all" || s === "enrich") await loop("enrich", () => stageEnrich(d, Math.min(limit, 50)));
if (s === "all" || s === "normalize") await loop("normalize", () => stageNormalize(d, Math.min(limit, 100)));
if (s === "all" || s === "embed") await loop("embed", () => stageEmbed(d, Math.min(limit, 500)));
if (s === "grade") { await loop("place", () => stagePlace(d, 500).then((r) => ({ done: r.done }))); await loop("grade", () => stageGrade(d, 100)); }
await c.runs.insertOne({ ...run, finishedAt: new Date() }); console.log(run.counts); await closeDb();
```
Add `"bootstrap": "tsx scripts/bootstrap.ts"` (already in Task 1 scripts).

- [ ] **Step 4: Run tests** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** — `git add scripts tests/unit/bootstrap.test.ts && git commit -m "feat: backlog bootstrap CLI"`

---

## Phase 2 — Batch layout job (Python)

All Python lives in `batch/` as the package `research_map_batch`, managed with `uv`. Run tests with `cd batch && uv run pytest -q`. The job connects to the same MongoDB (`MONGODB_URI`, `MONGODB_DB`) and uses `OPENAI_API_KEY`.

### Task 17: Python project, DB access, warm-started aligned layout

**Files:**
- Create: `batch/pyproject.toml`, `batch/README.md`, `batch/research_map_batch/__init__.py`, `batch/research_map_batch/db.py`, `batch/research_map_batch/layout.py`, `batch/tests/conftest.py`, `batch/tests/test_layout.py`

**Interfaces:**
- `db.py`: `connect() -> Database`, `load_vectors(db) -> tuple[list[str], np.ndarray]` (ids sorted by xId as int; only items with `stage ∈ {embedded, placed, graded}` and not deleted and kind not excluded), `load_published_layout(db) -> dict | None`, `load_relations_core(db) -> dict[str, dict]` (xId → {grade, role, rationale}), `load_normalized(db) -> dict[str, dict]` (xId → normalized + createdAt + kind).
- `layout.py`:
```python
def fit_display(E: np.ndarray, init: np.ndarray | None, seed: int = 42) -> np.ndarray          # 2-D UMAP, cosine, n_neighbors=15, min_dist=0.05, init=array or "spectral"
def fit_cluster_space(E: np.ndarray, seed: int = 42) -> np.ndarray                           # 10-D UMAP, min_dist=0.0
def build_init(ids, prev_ids, prev_xy, E) -> np.ndarray                                      # prev coords for shared ids; nearest-shared-neighbour coords (cosine, k=1) + tiny jitter for new ids
def align(xy: np.ndarray, prev_xy: np.ndarray, shared_new: np.ndarray, shared_prev: np.ndarray) -> tuple[np.ndarray, float]
    # similarity transform (scale, rotation/reflection, translation) fitted on shared index arrays via orthogonal_procrustes; applied to ALL rows; returns (aligned_xy, disparity) where disparity = scipy.spatial.procrustes disparity on the shared subset
def run_layout(ids, E, prev: dict | None, seed=42) -> dict   # {"xy": ndarray, "residual": float|None, "x10": ndarray}
```

- [ ] **Step 1: Project files**

`batch/pyproject.toml`:
```toml
[project]
name = "research-map-batch"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["numpy>=2", "scipy>=1.13", "scikit-learn>=1.5", "umap-learn>=0.5.7", "hdbscan>=0.8.40", "pymongo>=4.8", "openai>=1.60", "pydantic>=2", "shapely>=2.0"]
[project.scripts]
research-map-batch = "research_map_batch.main:cli"
[dependency-groups]
dev = ["pytest>=8"]
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```
Run: `cd batch && uv sync` (if numba refuses the local Python 3.14, run `uv python install 3.12 && uv sync --python 3.12`).

- [ ] **Step 2: Write the failing tests**

`batch/tests/conftest.py`:
```python
import numpy as np, pytest
@pytest.fixture(scope="session")
def blobs():
    rng = np.random.default_rng(0)
    centers = rng.normal(size=(3, 64)); X = np.vstack([c + 0.15 * rng.normal(size=(60, 64)) for c in centers])
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    ids = [str(10_000 + i) for i in range(len(X))]; labels = np.repeat([0, 1, 2], 60)
    return ids, X, labels
```
`batch/tests/test_layout.py`:
```python
import numpy as np
from research_map_batch.layout import fit_display, fit_cluster_space, build_init, align, run_layout

def test_fit_display_separates_blobs(blobs):
    ids, X, lab = blobs; xy = fit_display(X, None, seed=1)
    cents = np.array([xy[lab == k].mean(0) for k in range(3)])
    within = np.mean([np.linalg.norm(xy[lab == k] - cents[k], axis=1).mean() for k in range(3)])
    between = np.mean([np.linalg.norm(cents[i] - cents[j]) for i in range(3) for j in range(i + 1, 3)])
    assert between > 3 * within

def test_align_recovers_rotation_and_scale(blobs):
    ids, X, _ = blobs; xy = fit_display(X, None, seed=1)
    th = 0.7; R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]]); moved = 2.5 * xy @ R.T + np.array([10, -3])
    idx = np.arange(len(xy)); aligned, disp = align(moved, xy, idx, idx)
    assert np.allclose(aligned, xy, atol=1e-6); assert disp < 1e-9

def test_warm_start_keeps_layout_close(blobs):
    ids, X, _ = blobs; first = run_layout(ids, X, None, seed=1)
    prev = {"ids": ids, "xy": first["xy"]}
    second = run_layout(ids, X, prev, seed=2)              # different seed, warm start + alignment
    assert second["residual"] is not None and second["residual"] < 0.10

def test_build_init_places_new_points_near_their_neighbours(blobs):
    ids, X, lab = blobs; xy = fit_display(X, None, seed=1)
    new_ids = ids + ["999"]; Xn = np.vstack([X, X[0:1]])   # a copy of point 0 as a new point
    init = build_init(new_ids, ids, xy, Xn)
    assert np.linalg.norm(init[-1] - xy[0]) < 0.5

def test_cluster_space_dims(blobs):
    ids, X, _ = blobs; assert fit_cluster_space(X, seed=1).shape == (len(X), 10)
```

- [ ] **Step 3: Run** — `cd batch && uv run pytest -q tests/test_layout.py` → FAIL (import error)

- [ ] **Step 4: Implement `layout.py` and `db.py`**

```python
# batch/research_map_batch/layout.py
import numpy as np, umap, warnings
from scipy.linalg import orthogonal_procrustes
from scipy.spatial import procrustes as scipy_procrustes
from sklearn.neighbors import NearestNeighbors
warnings.filterwarnings("ignore")

def _norm(E): return E / np.linalg.norm(E, axis=1, keepdims=True)

def fit_display(E, init, seed=42):
    red = umap.UMAP(n_neighbors=15, min_dist=0.05, n_components=2, metric="cosine", random_state=seed, init="spectral" if init is None else init)
    return red.fit_transform(_norm(E)).astype(np.float64)

def fit_cluster_space(E, seed=42):
    return umap.UMAP(n_neighbors=15, min_dist=0.0, n_components=10, metric="cosine", random_state=seed).fit_transform(_norm(E))

def build_init(ids, prev_ids, prev_xy, E):
    pos = {pid: i for i, pid in enumerate(prev_ids)}; En = _norm(E)
    shared = [i for i, x in enumerate(ids) if x in pos]; new = [i for i, x in enumerate(ids) if x not in pos]
    init = np.zeros((len(ids), 2))
    for i in shared: init[i] = prev_xy[pos[ids[i]]]
    if new and shared:
        nn = NearestNeighbors(n_neighbors=1, metric="cosine").fit(En[shared]); _, j = nn.kneighbors(En[new])
        rng = np.random.default_rng(0); scale = 0.05 * (prev_xy.max(0) - prev_xy.min(0)).mean()
        for k, i in enumerate(new): init[i] = init[shared[j[k, 0]]] + rng.normal(scale=scale, size=2)
    return init

def align(xy, prev_xy, shared_new, shared_prev):
    A = xy[shared_new]; B = prev_xy[shared_prev]
    ma, mb = A.mean(0), B.mean(0); A0, B0 = A - ma, B - mb
    sa = np.linalg.norm(A0); sb = np.linalg.norm(B0)
    R, _ = orthogonal_procrustes(A0 / sa, B0 / sb)
    s = sb / sa
    aligned = ((xy - ma) @ R) * s + mb
    _, _, disp = scipy_procrustes(B, aligned[shared_new])
    return aligned, float(disp)

def run_layout(ids, E, prev, seed=42):
    init = None; residual = None
    if prev is not None and len(prev["ids"]):
        init = build_init(ids, prev["ids"], np.asarray(prev["xy"], dtype=float), E)
    xy = fit_display(E, init, seed=seed)
    if prev is not None and len(prev["ids"]):
        pos = {pid: i for i, pid in enumerate(prev["ids"])}
        shared_new = np.array([i for i, x in enumerate(ids) if x in pos]); shared_prev = np.array([pos[ids[i]] for i in shared_new])
        if len(shared_new) >= 3: xy, residual = align(xy, np.asarray(prev["xy"], dtype=float), shared_new, shared_prev)
    return {"xy": xy, "residual": residual, "x10": fit_cluster_space(E, seed=seed)}
```
```python
# batch/research_map_batch/db.py
import os, numpy as np
from pymongo import MongoClient
EXCLUDED = ["replyToOther", "retweet"]
def connect():
    return MongoClient(os.environ["MONGODB_URI"])[os.environ.get("MONGODB_DB", "research_map")]
def load_vectors(db):
    ok = {d["xId"] for d in db.items.find({"stage": {"$in": ["embedded", "placed", "graded"]}, "kind": {"$nin": EXCLUDED}, "deletedAt": {"$exists": False}}, {"xId": 1})}
    rows = [r for r in db.vectors.find({}, {"xId": 1, "embedding": 1}) if r["xId"] in ok]
    rows.sort(key=lambda r: int(r["xId"]))
    return [r["xId"] for r in rows], np.array([r["embedding"] for r in rows], dtype=np.float32)
def load_published_layout(db):
    return db.layouts.find_one({"status": "published"}, sort=[("version", -1)])
def load_relations_core(db):
    return {r["xId"]: r for r in db.relations.find({"questionId": "core"}, {"xId": 1, "grade": 1, "role": 1, "rationale": 1})}
def load_normalized(db):
    items = {i["xId"]: i for i in db.items.find({"kind": {"$nin": EXCLUDED}}, {"xId": 1, "createdAt": 1, "kind": 1, "text": 1})}
    out = {}
    for e in db.enrichment.find({"normalized": {"$exists": True}}, {"xId": 1, "normalized": 1}):
        if e["xId"] in items: out[e["xId"]] = {**e["normalized"], "createdAt": items[e["xId"]]["createdAt"], "kind": items[e["xId"]]["kind"]}
    return out
```

- [ ] **Step 5: Run** → PASS (UMAP on 180 points takes a few seconds per test; total < 1 min). If `test_warm_start_keeps_layout_close` is flaky above 0.10, loosen to 0.15 and record the measured value in `batch/README.md` — this is exactly the "measure warm-start stability" item from the spec.
- [ ] **Step 6: Commit** — `git add batch && git commit -m "feat(batch): python project, db access, warm-started aligned layout"`

### Task 18: Clustering, cluster matching with label reuse, hulls

**Files:**
- Create: `batch/research_map_batch/cluster.py`, `batch/research_map_batch/hulls.py`, `batch/tests/test_cluster.py`

**Interfaces:**
```python
def cluster(x10: np.ndarray, min_cluster_size=8, min_samples=3) -> np.ndarray                # HDBSCAN eom labels, -1 = noise
def match_clusters(new_labels: np.ndarray, ids: list[str], prev_points: list[dict], prev_clusters: list[dict], threshold=0.7) -> tuple[dict[int, int], dict[int, str]]
    # returns (new_id → stable_id, stable_id → reused_label). Stable ids: reuse prev cluster id when Jaccard(new members, prev members) ≥ threshold; otherwise allocate max(prev ids)+1+k. Noise stays -1.
def cluster_centroids(xy, labels) -> dict[int, tuple[float, float]]
def hulls(xy, labels, ratio=0.3) -> list[dict]       # shapely concave_hull per cluster with ≥ 4 points → {"clusterId", "polygon": [[x,y],...]}
```

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np
from research_map_batch.cluster import cluster, match_clusters, cluster_centroids
from research_map_batch.hulls import hulls
from research_map_batch.layout import fit_cluster_space, fit_display

def test_cluster_finds_three_blobs(blobs):
    ids, X, lab = blobs; labels = cluster(fit_cluster_space(X, seed=1))
    found = set(labels) - {-1}; assert len(found) == 3
    for k in range(3):
        vals, counts = np.unique(labels[lab == k], return_counts=True); assert counts.max() >= 50

def test_match_reuses_ids_and_labels_above_threshold():
    ids = [str(i) for i in range(10)]
    prev_points = [{"xId": str(i), "clusterId": 0 if i < 5 else 1} for i in range(10)]
    prev_clusters = [{"id": 0, "label": "Alpha"}, {"id": 1, "label": "Beta"}]
    new = np.array([0, 0, 0, 0, 1, 1, 1, 1, 1, -1])            # cluster 0 ≈ prev 0 (4/5 = 0.8), cluster 1 ≈ prev 1 (4/6 = 0.67 < 0.7)
    mapping, reused = match_clusters(new, ids, prev_points, prev_clusters, threshold=0.7)
    assert mapping[0] == 0 and reused[0] == "Alpha"; assert mapping[1] == 2 and 2 not in reused; assert mapping[-1] == -1

def test_centroids_and_hulls(blobs):
    ids, X, lab = blobs; xy = fit_display(X, None, seed=1)
    c = cluster_centroids(xy, lab); assert set(c) == {0, 1, 2}
    h = hulls(xy, lab); assert len(h) == 3 and all(len(p["polygon"]) >= 3 for p in h)
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# batch/research_map_batch/cluster.py
import numpy as np, hdbscan
def cluster(x10, min_cluster_size=8, min_samples=3):
    return hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples, cluster_selection_method="eom").fit(x10).labels_
def match_clusters(new_labels, ids, prev_points, prev_clusters, threshold=0.7):
    prev_members = {}
    for p in prev_points:
        if p["clusterId"] != -1: prev_members.setdefault(p["clusterId"], set()).add(p["xId"])
    prev_label = {c["id"]: c["label"] for c in prev_clusters}
    new_members = {}
    for i, l in enumerate(new_labels):
        if l != -1: new_members.setdefault(int(l), set()).add(ids[i])
    mapping, reused, taken = {-1: -1}, {}, set()
    next_id = (max(prev_label) + 1) if prev_label else 0
    for nl, mem in sorted(new_members.items(), key=lambda kv: -len(kv[1])):
        best, bj = None, 0.0
        for pid, pm in prev_members.items():
            if pid in taken: continue
            j = len(mem & pm) / len(mem | pm)
            if j > bj: best, bj = pid, j
        if best is not None and bj >= threshold:
            mapping[nl] = best; reused[best] = prev_label.get(best, ""); taken.add(best)
        else:
            mapping[nl] = next_id; next_id += 1
    return mapping, reused
def cluster_centroids(xy, labels):
    return {int(k): (float(xy[labels == k, 0].mean()), float(xy[labels == k, 1].mean())) for k in set(labels.tolist()) if k != -1}
# batch/research_map_batch/hulls.py
import numpy as np
from shapely import concave_hull, MultiPoint
def hulls(xy, labels, ratio=0.3):
    out = []
    for k in sorted(set(labels.tolist()) - {-1}):
        pts = xy[labels == k]
        if len(pts) < 4: continue
        poly = concave_hull(MultiPoint([tuple(p) for p in pts]), ratio=ratio)
        if poly.geom_type != "Polygon": poly = poly.convex_hull
        out.append({"clusterId": int(k), "polygon": [[float(x), float(y)] for x, y in poly.exterior.coords]})
    return out
```

- [ ] **Step 4: Run** → PASS; **Step 5: Commit** — `git add batch && git commit -m "feat(batch): hdbscan clustering, jaccard cluster matching, concave hulls"`

### Task 19: LLM labeling with reuse, themes, question-tree regrowth, trails

**Files:**
- Create: `batch/research_map_batch/label.py`, `batch/research_map_batch/questions.py`, `batch/research_map_batch/trails.py`, `batch/tests/test_label.py`

**Interfaces:**
```python
# label.py
class ClusterName(BaseModel): label: str; description: str
class ThemeName(BaseModel): label: str; description: str
def pick_examples(E, idx_in: np.ndarray, idx_out: np.ndarray, n_in=20, n_out=10) -> tuple[list[int], list[int]]   # closest-to-centroid in-cluster, nearest outside
def name_cluster(texts_in: list[str], texts_out: list[str], llm) -> ClusterName                                   # llm(prompt: str, model: type[BaseModel]) -> BaseModel
def build_themes(cluster_labels: dict[int, str], label_vectors: np.ndarray, llm, k: int | None = None) -> list[dict]  # k = clamp(round(sqrt(n)), 5, 9); kmeans on label vectors; LLM names each theme → [{"id", "label", "clusterIds"}]
def label_all(ids, E, texts: dict[str, str], stable_labels: np.ndarray, reused: dict[int, str], llm, embed) -> tuple[dict[int, dict], list[dict]]
# questions.py
def regrow(db, llm, embed, min_support=5, dedupe_cos=0.9) -> int   # for each active seed sub-question: rationales of grade≥2 items attached to it → propose ≤3 child questions each supported by ≥ min_support items → embed, drop if cosine ≥ dedupe_cos to any active question → insert {origin:"induced", parentId: seed id, validFrom: now, validTo: None}; returns inserted count
# trails.py
def rebuild_trails(db) -> int   # per active sub-question: items with relation grade ≥ 2 ordered by createdAt → trails upsert {_id:"q:<id>", questionId, name, steps:[{xId, note:"", position}], authority:"generated"}
```
- `llm` is an injectable callable; the real one uses `OpenAI().responses.parse(model=os.environ.get("OPENAI_TEXT_MODEL","gpt-5.4-mini"), input=[...], text_format=Model).output_parsed`. `embed` real = `client.embeddings.create(model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMS, input=texts)`.
- Naming prompt (Clio-style): system "You name topic clusters of one researcher's posts for a map. Labels are 2–5 words, specific, Title Case, no punctuation, English. Description one sentence." User: research question; "Posts IN the cluster:" bullet list of summaries; "Posts NEAR but NOT in the cluster (do not describe these):" bullet list; "Return a label that distinguishes the in-cluster posts from the nearby ones."
- Label-override file: `data/label-overrides.json` (`{"<clusterId>": "Label"}`) is read by `label_all` and wins over LLM and reused labels.

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np, json
from research_map_batch.label import pick_examples, name_cluster, build_themes, label_all, ClusterName, ThemeName

class FakeLLM:
    def __init__(self): self.calls = []
    def __call__(self, prompt, model):
        self.calls.append(prompt)
        if model is ClusterName: return ClusterName(label="Fake Cluster", description="d")
        return ThemeName(label="Fake Theme", description="d")

def fake_embed(texts): 
    rng = np.random.default_rng(len(texts)); return rng.normal(size=(len(texts), 8))

def test_pick_examples_prefers_centroid_and_nearest_outside(blobs):
    ids, X, lab = blobs; i_in = np.where(lab == 0)[0]; i_out = np.where(lab != 0)[0]
    a, b = pick_examples(X, i_in, i_out, n_in=5, n_out=3)
    assert len(a) == 5 and len(b) == 3 and set(a) <= set(i_in.tolist()) and set(b) <= set(i_out.tolist())

def test_name_cluster_prompt_contains_contrast():
    llm = FakeLLM(); r = name_cluster(["in one", "in two"], ["out one"], llm)
    assert r.label == "Fake Cluster"; assert "NOT in the cluster" in llm.calls[0] and "out one" in llm.calls[0]

def test_label_all_reuses_and_overrides(blobs, tmp_path, monkeypatch):
    ids, X, lab = blobs; llm = FakeLLM()
    texts = {i: f"summary {i}" for i in ids}
    ov = tmp_path / "label-overrides.json"; ov.write_text(json.dumps({"2": "Owner Label"})); monkeypatch.setenv("LABEL_OVERRIDES", str(ov))
    clusters, themes = label_all(ids, X, texts, lab, reused={0: "Kept Label"}, llm=llm, embed=fake_embed)
    assert clusters[0]["label"] == "Kept Label"; assert clusters[1]["label"] == "Fake Cluster"; assert clusters[2]["label"] == "Owner Label"
    assert sum(1 for c in llm.calls if "NOT in the cluster" in c) == 1          # only cluster 1 needed the LLM
    assert len(themes) >= 1 and all("clusterIds" in t for t in themes)

def test_build_themes_k_bounds():
    labels = {i: f"L{i}" for i in range(40)}; vecs = np.random.default_rng(0).normal(size=(40, 8))
    themes = build_themes(labels, vecs, FakeLLM()); assert 5 <= len(themes) <= 9 and sorted(c for t in themes for c in t["clusterIds"]) == list(range(40))
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# batch/research_map_batch/label.py
import os, json, numpy as np
from pydantic import BaseModel
from sklearn.cluster import KMeans
from sklearn.neighbors import NearestNeighbors
QUESTION = "How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?"
class ClusterName(BaseModel): label: str; description: str
class ThemeName(BaseModel): label: str; description: str

def pick_examples(E, idx_in, idx_out, n_in=20, n_out=10):
    En = E / np.linalg.norm(E, axis=1, keepdims=True); cen = En[idx_in].mean(0)
    order_in = idx_in[np.argsort(-(En[idx_in] @ cen))][:n_in]
    if len(idx_out) == 0: return order_in.tolist(), []
    order_out = idx_out[np.argsort(-(En[idx_out] @ cen))][:n_out]
    return order_in.tolist(), order_out.tolist()

def name_cluster(texts_in, texts_out, llm):
    prompt = (f"Research question of the author: {QUESTION}\n\nPosts IN the cluster:\n" + "\n".join(f"- {t[:300]}" for t in texts_in) +
              "\n\nPosts NEAR but NOT in the cluster (do not describe these):\n" + "\n".join(f"- {t[:200]}" for t in texts_out) +
              "\n\nName the cluster: a 2-5 word specific English Title Case label (no punctuation) that distinguishes the in-cluster posts from the nearby ones, plus a one-sentence description.")
    return llm(prompt, ClusterName)

def build_themes(cluster_labels, label_vectors, llm, k=None):
    cids = sorted(cluster_labels); n = len(cids)
    if n == 0: return []
    k = k or int(min(9, max(5, round(n ** 0.5)))); k = min(k, n)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(label_vectors)
    themes = []
    for t in range(k):
        members = [cids[i] for i in range(n) if km.labels_[i] == t]
        if not members: continue
        prompt = (f"Research question: {QUESTION}\n\nThese topic labels belong together on a map:\n" + "\n".join(f"- {cluster_labels[c]}" for c in members) +
                  "\n\nGive a 3-6 word Title Case theme name covering all of them and a one-sentence description.")
        name = llm(prompt, ThemeName); themes.append({"id": len(themes), "label": name.label, "description": name.description, "clusterIds": members})
    return themes

def _overrides():
    p = os.environ.get("LABEL_OVERRIDES", os.path.join(os.path.dirname(__file__), "..", "..", "data", "label-overrides.json"))
    try: return {int(k): v for k, v in json.load(open(p)).items()}
    except FileNotFoundError: return {}

def label_all(ids, E, texts, stable_labels, reused, llm, embed):
    ov = _overrides(); clusters = {}
    for k in sorted(set(stable_labels.tolist()) - {-1}):
        idx_in = np.where(stable_labels == k)[0]; idx_out = np.where((stable_labels != k) & (stable_labels != -1))[0]
        if k in ov: label, desc = ov[k], ""
        elif k in reused and reused[k]: label, desc = reused[k], ""
        else:
            a, b = pick_examples(E, idx_in, idx_out); nm = name_cluster([texts[ids[i]] for i in a], [texts[ids[i]] for i in b], llm); label, desc = nm.label, nm.description
        clusters[int(k)] = {"id": int(k), "label": label, "description": desc, "size": int(len(idx_in))}
    labels = {k: v["label"] for k, v in clusters.items()}
    vecs = np.asarray(embed([labels[k] for k in sorted(labels)])) if labels else np.zeros((0, 1))
    themes = build_themes(labels, vecs, llm)
    for t in themes:
        for c in t["clusterIds"]: clusters[c]["themeId"] = t["id"]
    return clusters, themes
```
```python
# batch/research_map_batch/questions.py
import numpy as np, datetime as dt
from pydantic import BaseModel
class Proposed(BaseModel): questions: list[str]
def regrow(db, llm, embed, min_support=5, dedupe_cos=0.9):
    active = list(db.questions.find({"validTo": None})); by_id = {q["_id"]: q for q in active}
    seeds = [q for q in active if q.get("parentId") == "core"]
    inserted = 0
    for s in seeds:
        rels = list(db.relations.find({"questionId": s["_id"], "grade": {"$gte": 2}}, {"rationale": 1}))
        if len(rels) < min_support: continue
        prompt = (f"Parent research sub-question: {s['text']}\n\nHere are {len(rels)} one-line rationales of posts that address it:\n" + "\n".join(f"- {r['rationale'][:200]}" for r in rels[:80]) +
                  f"\n\nPropose at most 3 more specific child questions, each clearly supported by at least {min_support} of the rationales. Return only questions that add a genuinely new angle. Empty list is fine.")
        props = llm(prompt, Proposed).questions[:3]
        if not props: continue
        vecs = np.asarray(embed(props)); existing = np.asarray([q["embedding"] for q in active if q.get("embedding")])
        for text, v in zip(props, vecs):
            v = v / np.linalg.norm(v)
            if len(existing) and (existing / np.linalg.norm(existing, axis=1, keepdims=True) @ v).max() >= dedupe_cos: continue
            qid = f"ind-{s['_id']}-{int(dt.datetime.utcnow().timestamp())}-{inserted}"
            db.questions.insert_one({"_id": qid, "text": text, "parentId": s["_id"], "embedding": v.tolist(), "validFrom": dt.datetime.utcnow(), "validTo": None, "origin": "induced"})
            existing = np.vstack([existing, v]) if len(existing) else v[None]; inserted += 1
    return inserted
# batch/research_map_batch/trails.py
def rebuild_trails(db):
    n = 0
    for q in db.questions.find({"validTo": None, "parentId": {"$ne": None}}):
        xids = [r["xId"] for r in db.relations.find({"questionId": q["_id"], "grade": {"$gte": 2}}, {"xId": 1})]
        items = sorted(db.items.find({"xId": {"$in": xids}, "deletedAt": {"$exists": False}}, {"xId": 1, "createdAt": 1}), key=lambda i: i["createdAt"])
        if len(items) < 2: continue
        db.trails.replace_one({"_id": f"q:{q['_id']}"}, {"_id": f"q:{q['_id']}", "questionId": q["_id"], "name": q["text"], "steps": [{"xId": it["xId"], "note": "", "position": i} for i, it in enumerate(items)], "authority": "generated"}, upsert=True); n += 1
    return n
```

- [ ] **Step 4: Run** → PASS; **Step 5: Commit** — `git add batch data/label-overrides.json && git commit -m "feat(batch): clio-style labeling with reuse, themes, question regrowth, trails"` (create `data/label-overrides.json` as `{}`).

### Task 20: Write layout version with residual gate, CLI, GitHub Actions

**Files:**
- Create: `batch/research_map_batch/write.py`, `batch/research_map_batch/main.py`, `batch/tests/test_write.py`, `.github/workflows/batch.yml`, `.github/workflows/ci.yml`

**Interfaces:**
```python
def assemble_layout(ids, xy, stable_labels, clusters: dict, themes: list, hulls: list, residual, prev_version: int, threshold=0.10, method="umap-warm-procrustes") -> dict
   # status = "published" if (residual is None or residual <= threshold) else "draft"; points provisional False; labels: level 0 themes (centroid of member clusters weighted by size), level 1 clusters; clusters list with x,y centroids & size & themeId
def write_layout(db, layout: dict) -> None       # insert; if published: items at stage "embedded" whose xId is in points → stage "placed"; also any item with stage "placed"/"graded" keeps stage; previous published layouts remain (append-only)
def cli() -> None                                # argparse: run [--seed 42] [--threshold 0.10] [--force-publish] [--dry-run] [--skip-questions]
```

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from research_map_batch.write import assemble_layout
def test_gate_drafts_when_residual_high():
    ids = ["1", "2", "3"]; xy = np.array([[0, 0], [1, 1], [2, 2]], float); lab = np.array([0, 0, -1])
    clusters = {0: {"id": 0, "label": "A", "description": "", "size": 2, "themeId": 0}}; themes = [{"id": 0, "label": "T", "description": "", "clusterIds": [0]}]
    ok = assemble_layout(ids, xy, lab, clusters, themes, [], residual=0.03, prev_version=1)
    bad = assemble_layout(ids, xy, lab, clusters, themes, [], residual=0.25, prev_version=1)
    assert ok["status"] == "published" and ok["version"] == 2 and bad["status"] == "draft"
    assert [p["provisional"] for p in ok["points"]] == [False, False, False]
    assert {l["level"] for l in ok["labels"]} == {0, 1} and ok["clusters"][0]["x"] == 0.5
def test_first_layout_publishes_without_residual():
    l = assemble_layout(["1"], np.zeros((1, 2)), np.array([-1]), {}, [], [], residual=None, prev_version=0); assert l["status"] == "published" and l["version"] == 1
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```python
# batch/research_map_batch/write.py
import datetime as dt, numpy as np
def assemble_layout(ids, xy, stable_labels, clusters, themes, hulls, residual, prev_version, threshold=0.10, method="umap-warm-procrustes"):
    status = "published" if (residual is None or residual <= threshold) else "draft"
    points = [{"xId": ids[i], "x": float(xy[i, 0]), "y": float(xy[i, 1]), "clusterId": int(stable_labels[i]), "provisional": False} for i in range(len(ids))]
    cl = []
    for k, c in sorted(clusters.items()):
        m = stable_labels == k; cl.append({**c, "x": float(xy[m, 0].mean()), "y": float(xy[m, 1].mean()), "themeId": c.get("themeId", -1)})
    labels = [{"level": 1, "text": c["label"], "x": c["x"], "y": c["y"], "priority": 100 + c["size"], "clusterId": c["id"]} for c in cl]
    for t in themes:
        mem = [c for c in cl if c["id"] in t["clusterIds"]]; n = sum(c["size"] for c in mem) or 1
        labels.append({"level": 0, "text": t["label"], "x": sum(c["x"] * c["size"] for c in mem) / n, "y": sum(c["y"] * c["size"] for c in mem) / n, "priority": 1000 + n, "clusterId": -1, "themeId": t["id"]})
    return {"version": prev_version + 1, "createdAt": dt.datetime.utcnow(), "method": method, "status": status, "points": points, "labels": labels,
            "themes": [{"id": t["id"], "label": t["label"], "clusterIds": t["clusterIds"]} for t in themes], "clusters": cl, "hulls": hulls, "procrustesResidual": residual}
def write_layout(db, layout):
    db.layouts.insert_one(layout)
    if layout["status"] == "published":
        db.items.update_many({"xId": {"$in": [p["xId"] for p in layout["points"]]}, "stage": "embedded"}, {"$set": {"stage": "placed"}})
```
```python
# batch/research_map_batch/main.py
import argparse, os, sys, numpy as np
from openai import OpenAI
from .db import connect, load_vectors, load_published_layout, load_normalized
from .layout import run_layout
from .cluster import cluster, match_clusters
from .hulls import hulls as make_hulls
from .label import label_all
from .questions import regrow
from .trails import rebuild_trails
from .write import assemble_layout, write_layout

def make_llm():
    client = OpenAI(); model = os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.4-mini")
    def llm(prompt, schema):
        r = client.responses.parse(model=model, input=[{"role": "user", "content": prompt}], text_format=schema); return r.output_parsed
    def embed(texts):
        r = client.embeddings.create(model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-large"), dimensions=int(os.environ.get("EMBEDDING_DIMS", "1024")), input=texts)
        return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]
    return llm, embed

def cli():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True); r = sub.add_parser("run")
    r.add_argument("--seed", type=int, default=42); r.add_argument("--threshold", type=float, default=0.10); r.add_argument("--force-publish", action="store_true"); r.add_argument("--dry-run", action="store_true"); r.add_argument("--skip-questions", action="store_true")
    a = ap.parse_args(); db = connect(); llm, embed = make_llm()
    ids, E = load_vectors(db); print(f"{len(ids)} vectors", file=sys.stderr)
    if len(ids) < 20: print("too few vectors", file=sys.stderr); sys.exit(1)
    prev = load_published_layout(db)
    prev_arg = {"ids": [p["xId"] for p in prev["points"]], "xy": [[p["x"], p["y"]] for p in prev["points"]]} if prev else None
    lay = run_layout(ids, E, prev_arg, seed=a.seed); print(f"residual={lay['residual']}", file=sys.stderr)
    raw = cluster(lay["x10"]); mapping, reused = match_clusters(raw, ids, prev["points"] if prev else [], prev["clusters"] if prev else [])
    stable = np.array([mapping[int(l)] for l in raw]); print(f"clusters={len(set(stable) - {-1})} noise={np.mean(stable == -1):.1%} reused={len(reused)}", file=sys.stderr)
    norm = load_normalized(db); texts = {i: f"{norm.get(i, {}).get('title', '')}: {norm.get(i, {}).get('summaryEn', '')}" for i in ids}
    clusters, themes = label_all(ids, E, texts, stable, reused, llm, embed)
    layout = assemble_layout(ids, lay["xy"], stable, clusters, themes, make_hulls(lay["xy"], stable), None if a.force_publish else lay["residual"], prev["version"] if prev else 0, threshold=a.threshold)
    if a.dry_run: print({k: (v if k not in ("points", "labels", "hulls") else len(v)) for k, v in layout.items()}); return
    write_layout(db, layout); print(f"wrote layout v{layout['version']} status={layout['status']}", file=sys.stderr)
    if layout["status"] == "published" and not a.skip_questions:
        print(f"questions inserted: {regrow(db, llm, embed)}; trails: {rebuild_trails(db)}", file=sys.stderr)
```
`.github/workflows/batch.yml`:
```yaml
name: batch-relayout
on:
  workflow_dispatch:
    inputs: { force_publish: { type: boolean, default: false } }
  repository_dispatch:
    types: [relayout]
jobs:
  relayout:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv python install 3.12 && cd batch && uv sync --python 3.12
      - run: cd batch && uv run research-map-batch run ${{ inputs.force_publish && '--force-publish' || '' }}
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          MONGODB_DB: research_map
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_TEXT_MODEL: gpt-5.4-mini
          EMBEDDING_MODEL: text-embedding-3-large
          EMBEDDING_DIMS: "1024"
      - name: Trigger publish
        run: curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "https://research.nalenz.org/api/cron/ingest?force=1"
```
(`?force=1` → in the cron route, pass `force: true` to `runDaily` when the query param is present; add that one line to Task 15's route.)

`.github/workflows/ci.yml`: on push/PR: pnpm install, `pnpm typecheck`, `pnpm test` (unit only; integration skipped without secret), and `cd batch && uv sync && uv run pytest -q`.

- [ ] **Step 4: Run** `uv run pytest -q` → all batch tests PASS; **Step 5: Commit** — `git add batch .github && git commit -m "feat(batch): layout writer with residual gate, CLI, GitHub Actions"`

---

## Phase 3 — Canvas UI (Next.js, Embedding Atlas)

Client code lives in `app/canvas/`. Pure logic (lenses, colours, URL state, card visibility, export) is unit-tested with Vitest; the rendered canvas is covered by the Playwright smoke test in Task 27.

### Task 21: Snapshot loading, lenses, colours, URL state (pure logic)

**Files:**
- Create: `app/canvas/useSnapshot.ts`, `app/canvas/lenses.ts`, `app/canvas/colors.ts`, `app/canvas/urlState.ts`, `tests/unit/lenses.test.ts`, `tests/unit/colors.test.ts`, `tests/unit/urlState.test.ts`

**Interfaces:**
```ts
// useSnapshot.ts
export interface Snapshot { points: PointsFile; labels: LabelsFile; meta: MetaFile | null; manifest: Manifest; }
export function useSnapshot(): { snap: Snapshot | null; error: string | null; loadMeta: () => Promise<MetaFile> };   // fetch /api/manifest → pointsUrl + labelsUrl eagerly; meta lazily (cached)
// lenses.ts
export type LensId = "terrain" | "question" | "time";
export interface LensDef { id: LensId; name: string; purpose: string; preserves: string[]; drops: string[]; }
export const LENSES: LensDef[];
export function terrainXY(p: PointsFile): { x: Float32Array; y: Float32Array };
export function questionXY(p: PointsFile, centerId: string): { x: Float32Array; y: Float32Array };   // angle = atan2 around terrain centroid; radius = (3.5 - grade) * R + jitter(id); the research-question post sits at (cx, cy)
export function timeXY(p: PointsFile, primarySub: (string | null)[], subOrder: string[]): { x: Float32Array; y: Float32Array }; // x = cumulative log1p(month count) position within month + jitter; y = sub-question row (unknown → last row) + jitter
export function lensXY(id: LensId, p: PointsFile, ctx: { centerId: string; primarySub: (string | null)[]; subOrder: string[] }): { x: Float32Array; y: Float32Array };
export function tween(a: Float32Array, b: Float32Array, t: number, out: Float32Array): Float32Array;   // ease-in-out cubic
// colors.ts
export const LEAF_PALETTE: string[];   // 24 distinguishable hues (OKLCH-ish), looped
export function categoryIndex(leaf: number, grade: number): number;         // (leafSlot % 60) * 4 + clamp(grade,0,3); leaf -1 → slot 60..  (uses 61 slots → max 244 < 256)
export function categoryColors(): string[];                                 // 244 entries: leaf hue with alpha by grade: g3 1.0, g2 0.85, g1 0.45, g0 0.18
export function visibleMask(p: PointsFile, minGrade: number, showAll: boolean, filters: { kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] }, meta: MetaFile | null): Uint8Array;
// urlState.ts
export interface UrlState { lens: LensId; minGrade: number; showAll: boolean; q?: string; sel?: string; v?: [number, number, number]; }
export function parseUrlState(search: string): UrlState;   // defaults: terrain, 1, false
export function serializeUrlState(s: UrlState): string;
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/lenses.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { terrainXY, questionXY, timeXY, tween, LENSES } from "@/app/canvas/lenses";
const p: any = { ids: ["q", "a", "b", "c"], x: [0, 1, -1, 0], y: [0, 0, 0, 2], grade: [3, 3, 1, 0], createdAt: [1700000000, 1702600000, 1705200000, 1705200000], leaf: [0, 0, 1, -1], count: 4 };
describe("lenses", () => {
  it("terrain copies coordinates into Float32Arrays", () => { const r = terrainXY(p); expect(r.x).toBeInstanceOf(Float32Array); expect(Array.from(r.x)).toEqual([0, 1, -1, 0]); });
  it("question lens puts the centre item at the centroid and higher grades closer", () => {
    const r = questionXY(p, "q"); const cx = r.x[0], cy = r.y[0];
    const d = (i: number) => Math.hypot(r.x[i] - cx, r.y[i] - cy);
    expect(d(1)).toBeLessThan(d(2)); expect(d(2)).toBeLessThan(d(3));
  });
  it("question lens preserves angular order from terrain", () => {
    const r = questionXY(p, "q"); const ang = (x: number, y: number) => Math.atan2(y, x);
    expect(Math.sign(ang(r.x[1] - r.x[0], r.y[1] - r.y[0]))).toBe(Math.sign(ang(1, 0)) || 1);
  });
  it("time lens orders x by month and rows by sub-question", () => {
    const r = timeXY(p, [null, "s1", "s2", null], ["s1", "s2"]);
    expect(r.x[1]).toBeLessThan(r.x[2]); expect(r.y[1]).not.toBeCloseTo(r.y[2], 0); expect(r.x[2]).toBeCloseTo(r.x[3], 0);
  });
  it("tween eases between arrays", () => {
    const a = new Float32Array([0, 0]), b = new Float32Array([10, 20]), out = new Float32Array(2);
    expect(Array.from(tween(a, b, 0, out))).toEqual([0, 0]); expect(Array.from(tween(a, b, 1, out))).toEqual([10, 20]); expect(tween(a, b, 0.5, out)[1]).toBeCloseTo(10);
  });
  it("every lens declares purpose, preserves and drops", () => { for (const l of LENSES) { expect(l.purpose.length).toBeGreaterThan(10); expect(l.preserves.length).toBeGreaterThan(0); expect(l.drops.length).toBeGreaterThan(0); } });
});
```
`tests/unit/colors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { categoryIndex, categoryColors, visibleMask } from "@/app/canvas/colors";
describe("colors", () => {
  it("category index is stable, bounded, and separates grades", () => {
    const cols = categoryColors(); expect(cols.length).toBeLessThanOrEqual(256);
    expect(categoryIndex(0, 3)).not.toBe(categoryIndex(0, 1)); expect(categoryIndex(-1, 2)).toBeLessThan(cols.length); expect(categoryIndex(500, 0)).toBeLessThan(cols.length);
  });
  it("visibleMask hides below minGrade unless showAll; unclustered points are never hidden by leaf", () => {
    const p: any = { count: 3, grade: [3, 0, 2], leaf: [0, -1, -1], kind: [0, 0, 1], createdAt: [0, 0, 0] };
    expect(Array.from(visibleMask(p, 1, false, {}, null))).toEqual([1, 0, 1]);
    expect(Array.from(visibleMask(p, 1, true, {}, null))).toEqual([1, 1, 1]);
    expect(Array.from(visibleMask(p, 0, true, { kinds: new Set([1]) }, null))).toEqual([0, 0, 1]);
  });
});
```
`tests/unit/urlState.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseUrlState, serializeUrlState } from "@/app/canvas/urlState";
describe("urlState", () => {
  it("defaults", () => { expect(parseUrlState("")).toEqual({ lens: "terrain", minGrade: 1, showAll: false }); });
  it("round-trips", () => { const s = { lens: "question" as const, minGrade: 2, showAll: true, q: "audit trust", sel: "123", v: [1.5, -2, 3] as [number, number, number] }; expect(parseUrlState(serializeUrlState(s))).toEqual(s); });
  it("ignores garbage", () => { expect(parseUrlState("?lens=nope&g=9").lens).toBe("terrain"); expect(parseUrlState("?g=9").minGrade).toBe(1); });
});
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// app/canvas/lenses.ts
import type { PointsFile } from "@/lib/snapshot";
export type LensId = "terrain" | "question" | "time";
export interface LensDef { id: LensId; name: string; purpose: string; preserves: string[]; drops: string[]; }
export const LENSES: LensDef[] = [
  { id: "terrain", name: "Topic terrain", purpose: "Where posts sit relative to each other by meaning; density shows the themes I keep returning to.", preserves: ["semantic neighbourhoods", "cluster membership"], drops: ["time", "relevance to the question (only colour intensity)"] },
  { id: "question", name: "Around the question", purpose: "How directly each post speaks to the core question; the question sits at the centre.", preserves: ["angular neighbourhoods from the terrain", "graded relevance as radius"], drops: ["density", "exact semantic distance"] },
  { id: "time", name: "Time strata", purpose: "How the inquiry unfolded: months left to right, sub-questions as rows.", preserves: ["chronology", "sub-question attachment"], drops: ["semantic neighbourhoods"] },
];
const hash01 = (s: string, salt: number) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; };
export function terrainXY(p: PointsFile) { return { x: Float32Array.from(p.x), y: Float32Array.from(p.y) }; }
export function questionXY(p: PointsFile, centerId: string) {
  const n = p.count; const cx = p.x.reduce((a, b) => a + b, 0) / n, cy = p.y.reduce((a, b) => a + b, 0) / n;
  const ext = Math.max(...p.x) - Math.min(...p.x) || 1; const R = ext / 8;
  const x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (p.ids[i] === centerId) { x[i] = cx; y[i] = cy; continue; }
    const ang = Math.atan2(p.y[i] - cy, p.x[i] - cx); const r = (3.5 - Math.min(3, Math.max(0, p.grade[i]))) * R + (hash01(p.ids[i], 1) - 0.5) * R * 0.8;
    x[i] = cx + r * Math.cos(ang); y[i] = cy + r * Math.sin(ang);
  }
  return { x, y };
}
export function timeXY(p: PointsFile, primarySub: (string | null)[], subOrder: string[]) {
  const n = p.count; const month = (t: number) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const counts = new Map<number, number>(); for (let i = 0; i < n; i++) counts.set(month(p.createdAt[i]), (counts.get(month(p.createdAt[i])) ?? 0) + 1);
  const months = [...counts.keys()].sort((a, b) => a - b); const start = new Map<number, [number, number]>(); let cur = 0;
  for (const m of months) { const w = Math.log1p(counts.get(m)!); start.set(m, [cur, w]); cur += w + 0.2; }
  const rows = new Map(subOrder.map((s, i) => [s, i])); const lastRow = subOrder.length;
  const x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [s, w] = start.get(month(p.createdAt[i]))!; x[i] = s + hash01(p.ids[i], 2) * w; const row = primarySub[i] && rows.has(primarySub[i]!) ? rows.get(primarySub[i]!)! : lastRow; y[i] = -(row + hash01(p.ids[i], 3) * 0.8); }
  return { x, y };
}
export function lensXY(id: LensId, p: PointsFile, ctx: { centerId: string; primarySub: (string | null)[]; subOrder: string[] }) {
  return id === "terrain" ? terrainXY(p) : id === "question" ? questionXY(p, ctx.centerId) : timeXY(p, ctx.primarySub, ctx.subOrder);
}
export function tween(a: Float32Array, b: Float32Array, t: number, out: Float32Array) { const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * e; return out; }
// app/canvas/colors.ts
import type { MetaFile, PointsFile } from "@/lib/snapshot";
export const LEAF_PALETTE = ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac","#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf","#aec7e8","#ffbb78","#98df8a","#c5b0d5"];
const SLOTS = 61; const ALPHA = [0.18, 0.45, 0.85, 1.0];
export function categoryIndex(leaf: number, grade: number) { const slot = leaf < 0 ? SLOTS - 1 : leaf % (SLOTS - 1); return slot * 4 + Math.min(3, Math.max(0, Math.round(grade))); }
const withAlpha = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
export function categoryColors(): string[] { const out: string[] = []; for (let s = 0; s < SLOTS; s++) { const base = s === SLOTS - 1 ? "#cfcfcf" : LEAF_PALETTE[s % LEAF_PALETTE.length]; for (let g = 0; g < 4; g++) out.push(withAlpha(base, ALPHA[g])); } return out; }
export function visibleMask(p: PointsFile, minGrade: number, showAll: boolean, f: { kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] }, meta: MetaFile | null): Uint8Array {
  const m = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let v = showAll || p.grade[i] >= minGrade;
    if (v && f.kinds && !f.kinds.has(p.kind[i])) v = false;
    if (v && f.langs && meta && !f.langs.has(meta.lang[i])) v = false;
    if (v && f.monthRange) { const t = p.createdAt[i]; if (t < f.monthRange[0] || t > f.monthRange[1]) v = false; }
    m[i] = v ? 1 : 0;
  }
  return m;
}
// app/canvas/urlState.ts
import type { LensId } from "./lenses";
export interface UrlState { lens: LensId; minGrade: number; showAll: boolean; q?: string; sel?: string; v?: [number, number, number]; }
export function parseUrlState(search: string): UrlState {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search); const s: UrlState = { lens: "terrain", minGrade: 1, showAll: false };
  const lens = sp.get("lens"); if (lens === "terrain" || lens === "question" || lens === "time") s.lens = lens;
  const g = Number(sp.get("g")); if (Number.isInteger(g) && g >= 0 && g <= 3) s.minGrade = g;
  if (sp.get("all") === "1") s.showAll = true; const q = sp.get("q"); if (q) s.q = q; const sel = sp.get("sel"); if (sel) s.sel = sel;
  const v = sp.get("v")?.split(",").map(Number); if (v && v.length === 3 && v.every(Number.isFinite)) s.v = v as [number, number, number];
  return s;
}
export function serializeUrlState(s: UrlState): string {
  const sp = new URLSearchParams(); if (s.lens !== "terrain") sp.set("lens", s.lens); if (s.minGrade !== 1) sp.set("g", String(s.minGrade)); if (s.showAll) sp.set("all", "1");
  if (s.q) sp.set("q", s.q); if (s.sel) sp.set("sel", s.sel); if (s.v) sp.set("v", s.v.join(",")); const str = sp.toString(); return str ? `?${str}` : "";
}
```
`app/canvas/useSnapshot.ts`:
```ts
"use client";
import { useEffect, useRef, useState } from "react"; import type { PointsFile, MetaFile, LabelsFile } from "@/lib/snapshot"; import type { Manifest } from "@/lib/types";
export interface Snapshot { points: PointsFile; labels: LabelsFile; meta: MetaFile | null; manifest: Manifest; }
export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null); const [error, setError] = useState<string | null>(null); const metaP = useRef<Promise<MetaFile> | null>(null);
  useEffect(() => { (async () => { try {
    const manifest: Manifest = await (await fetch("/api/manifest")).json(); if ((manifest as any).error) throw new Error((manifest as any).error);
    const [points, labels] = await Promise.all([fetch(manifest.pointsUrl).then((r) => r.json()), fetch(manifest.labelsUrl).then((r) => r.json())]);
    setSnap({ points, labels, meta: null, manifest });
  } catch (e) { setError(String(e)); } })(); }, []);
  const loadMeta = () => { if (!snap) return Promise.reject(new Error("no snapshot")); if (!metaP.current) metaP.current = fetch(snap.manifest.metaUrl).then((r) => r.json()).then((m: MetaFile) => { setSnap((s) => (s ? { ...s, meta: m } : s)); return m; }); return metaP.current; };
  return { snap, error, loadMeta };
}
```

- [ ] **Step 4: Run** → PASS; **Step 5: Commit** — `git add app/canvas tests/unit/lenses.test.ts tests/unit/colors.test.ts tests/unit/urlState.test.ts && git commit -m "feat(canvas): snapshot loading, lenses, colours, url state"`

### Task 22: The canvas component (Embedding Atlas) with WebGPU check

**Files:**
- Modify: `app/canvas/Canvas.tsx` (replace placeholder)
- Create: `app/canvas/webgpu.ts`, `app/canvas/CanvasFallback.tsx` (message only; real fallback in Task 27), `tests/unit/webgpu.test.ts`

**Interfaces:**
- `webgpu.ts`: `hasWebGPU(nav: Partial<Navigator> = navigator): boolean` (`"gpu" in nav`); `export const FALLBACK_MESSAGE`.
- `Canvas.tsx` renders: `useSnapshot()`; builds `data = { x, y, category }` typed arrays from the current lens (`lensXY`) and `categoryIndex`; hidden points (mask 0) are **filtered out** of the arrays (keep an `indexMap: number[]` from array row → point index); `labels` = `snap.labels.labels` mapped to `{ x, y, content, level, priority }` for terrain lens only (other lenses: level-0 labels replaced by sub-question row labels / ring labels "grade 3 … grade 0"); `config = { mode: zoomScale < 1.5 ? "density" : "points", minimumDensity: 0.002, colorScheme: "dark" }`; `viewportState` controlled, synced to URL (debounced 300 ms) via `onViewportState`; `onTooltip` sets hover; `onSelection` sets `sel` in URL and opens the inspector; `customOverlay` from Task 23; lens switch runs a 600 ms rAF tween with `tween()` writing into preallocated Float32Arrays and re-rendering each frame.
- If `!hasWebGPU()` render `<CanvasFallback/>` (Task 27 decides whether it becomes a real deck.gl renderer).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { hasWebGPU, FALLBACK_MESSAGE } from "@/app/canvas/webgpu";
describe("webgpu detection", () => { it("detects navigator.gpu", () => { expect(hasWebGPU({ gpu: {} } as any)).toBe(true); expect(hasWebGPU({} as any)).toBe(false); expect(FALLBACK_MESSAGE).toMatch(/WebGPU/); }); });
```
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**

```tsx
// app/canvas/webgpu.ts
export function hasWebGPU(nav: Partial<Navigator> = typeof navigator === "undefined" ? {} : navigator) { return "gpu" in nav && !!(nav as any).gpu; }
export const FALLBACK_MESSAGE = "This map renders with WebGPU, which your browser does not expose. Try a current Chrome, Edge, Safari or Firefox.";
// app/canvas/Canvas.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react"; import { EmbeddingView, type ViewportState, type DataPoint } from "embedding-atlas/react";
import { useSnapshot } from "./useSnapshot"; import { lensXY, tween, type LensId } from "./lenses"; import { categoryColors, categoryIndex, visibleMask } from "./colors"; import { parseUrlState, serializeUrlState, type UrlState } from "./urlState";
import { hasWebGPU, FALLBACK_MESSAGE } from "./webgpu"; import { CardOverlay } from "./CardOverlay"; import TopBar from "./TopBar"; import Inspector from "./Inspector"; import Filters from "./Filters";
const COLORS = categoryColors();
export default function Canvas() {
  const { snap, error, loadMeta } = useSnapshot();
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  const [viewport, setViewport] = useState<ViewportState | null>(url.v ? { x: url.v[0], y: url.v[1], scale: url.v[2] } : null);
  const [tooltip, setTooltip] = useState<DataPoint | null>(null); const [filters, setFilters] = useState<{ kinds?: Set<number>; langs?: Set<string>; monthRange?: [number, number] }>({});
  const [size, setSize] = useState({ w: 800, h: 600 }); const host = useRef<HTMLDivElement>(null);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); if (host.current) ro.observe(host.current); return () => ro.disconnect(); }, []);
  useEffect(() => { const s = serializeUrlState({ ...url, v: viewport ? [+viewport.x.toFixed(3), +viewport.y.toFixed(3), +viewport.scale.toFixed(3)] : undefined }); const t = setTimeout(() => history.replaceState(null, "", location.pathname + s), 300); return () => clearTimeout(t); }, [url, viewport]);
  const ctx = useMemo(() => snap ? { centerId: process.env.NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID ?? "2115703316281778260", primarySub: snap.points.ids.map((_, i) => snap.meta?.subQuestions[i]?.[0] ?? null), subOrder: snap.labels.questions.filter((q) => q.parentId === "core").map((q) => q.id) } : null, [snap]);
  const mask = useMemo(() => snap ? visibleMask(snap.points, url.minGrade, url.showAll, filters, snap.meta) : null, [snap, url.minGrade, url.showAll, filters]);
  const target = useMemo(() => snap && ctx ? lensXY(url.lens, snap.points, ctx) : null, [snap, ctx, url.lens]);
  const [xy, setXy] = useState<{ x: Float32Array; y: Float32Array } | null>(null); const prev = useRef<{ x: Float32Array; y: Float32Array } | null>(null);
  useEffect(() => { if (!target) return; const from = prev.current ?? target; const n = target.x.length; const ox = new Float32Array(n), oy = new Float32Array(n); let raf = 0; const t0 = performance.now();
    const step = (now: number) => { const t = Math.min(1, (now - t0) / 600); setXy({ x: tween(from.x, target.x, t, ox).slice(), y: tween(from.y, target.y, t, oy).slice() }); if (t < 1) raf = requestAnimationFrame(step); else prev.current = target; };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf); }, [target]);
  const data = useMemo(() => { if (!snap || !xy || !mask) return null; const idx: number[] = []; for (let i = 0; i < snap.points.count; i++) if (mask[i]) idx.push(i);
    const x = new Float32Array(idx.length), y = new Float32Array(idx.length), category = new Uint8Array(idx.length);
    idx.forEach((i, r) => { x[r] = xy.x[i]; y[r] = xy.y[i]; category[r] = categoryIndex(snap.points.leaf[i], snap.points.grade[i]); }); return { x, y, category, idx }; }, [snap, xy, mask]);
  const labels = useMemo(() => snap && url.lens === "terrain" ? snap.labels.labels : snap ? snap.labels.questions.filter((q) => q.parentId === "core").map((q, i) => ({ x: 0, y: -(i + 0.4), content: q.text, level: 0, priority: 1000 })) : [], [snap, url.lens]);
  if (!hasWebGPU()) return <div style={{ padding: 24 }}>{FALLBACK_MESSAGE}</div>;
  if (error) return <div style={{ padding: 24 }}>Could not load the map: {error}</div>;
  if (!snap || !data) return <div style={{ padding: 24 }}>Loading map…</div>;
  const scale = viewport?.scale ?? 1;
  return (<div ref={host} style={{ position: "fixed", inset: 0 }}>
    <EmbeddingView data={{ x: data.x, y: data.y, category: data.category }} categoryColors={COLORS} labels={labels} width={size.w} height={size.h}
      config={{ colorScheme: "dark", mode: scale < 1.5 && url.lens === "terrain" ? "density" : "points", minimumDensity: 0.002, autoLabelEnabled: false }}
      viewportState={viewport} onViewportState={setViewport} tooltip={tooltip} onTooltip={setTooltip}
      onSelection={(pts) => { const r = pts?.[0]; if (!r) return; const i = data.idx[Number(r.identifier ?? data.x.indexOf(r.x))]; setUrl((u) => ({ ...u, sel: snap.points.ids[i] })); loadMeta(); }}
      customOverlay={{ class: CardOverlay, props: { snap, idx: data.idx, scale, selected: url.sel, loadMeta } }} />
    <TopBar url={url} setUrl={setUrl} snap={snap} onFlyTo={(i) => { setViewport({ x: xy!.x[i], y: xy!.y[i], scale: 6 }); }} />
    <Filters snap={snap} filters={filters} setFilters={setFilters} url={url} setUrl={setUrl} loadMeta={loadMeta} />
    {url.sel && <Inspector snap={snap} xId={url.sel} onClose={() => setUrl((u) => ({ ...u, sel: undefined }))} loadMeta={loadMeta} />}
  </div>);
}
```
(Until Tasks 23–25 exist, create minimal `CardOverlay`, `TopBar`, `Inspector`, `Filters` stubs that render nothing so the build passes; each later task replaces its stub.)

- [ ] **Step 4: Run unit test → PASS; `pnpm typecheck`; `pnpm dev`** with a published snapshot (after Phase 4 bootstrap) or with a local fixture snapshot: add `scripts/fixture-snapshot.ts` that builds a snapshot from `tests/fixtures` with random coordinates and serves it by writing to `public/dev/` and setting `NEXT_PUBLIC_DEV_MANIFEST=/dev/manifest.json` (useSnapshot reads that env first when set). Open http://localhost:3000, confirm points and labels render and zoom works.
- [ ] **Step 5: Day-one WebGPU check**: open the page in Chromium with `--disable-features=WebGPU` (or Firefox with `dom.webgpu.enabled=false`). Record in `docs/superpowers/plans/notes-webgpu.md` whether `EmbeddingView` renders (it may fall back internally) or throws. This result decides Task 27B.
- [ ] **Step 6: Commit** — `git add app/canvas scripts/fixture-snapshot.ts tests/unit/webgpu.test.ts docs/superpowers/plans/notes-webgpu.md && git commit -m "feat(canvas): embedding atlas view with lenses, viewport url sync, webgpu check"`

### Task 23: Card overlay — DOM cards at close zoom, provisional rings, arrival trail

**Files:**
- Create: `app/canvas/CardOverlay.ts`, `app/canvas/overlayLogic.ts`, `tests/unit/overlayLogic.test.ts`

**Interfaces:**
- `overlayLogic.ts` (pure): `visibleRows(xs: Float32Array, ys: Float32Array, proj: (x: number, y: number) => { x: number; y: number }, w: number, h: number, max = 50): number[]` — rows whose projected pixel lies inside the viewport, sorted by distance to the centre, capped; `newestRows(points: PointsFile, idx: number[], k = 20): number[]` — rows of the k most recent `createdAt`; `cardHtml(meta: MetaFile, i: number, point: { grade: number; provisional: boolean; url: string }): string` — escaped HTML for one card (title, gist ≤ 200 chars, domain, date, grade badge, "Open on X" link with name + @handle; satisfies X display minimum).
- `CardOverlay` class (`constructor(target: HTMLDivElement, props)`, `update(props)`, `destroy()`): props `{ proxy: OverlayProxy; snap: Snapshot; idx: number[]; scale: number; selected?: string; loadMeta: () => Promise<MetaFile> }`. Draws: (a) an SVG layer with hollow rings on provisional rows and a halo on the 20 newest rows plus a faint polyline connecting them in time order; (b) when `scale ≥ 5` and meta loaded, absolutely positioned cards for `visibleRows(..., 50)`; cards are `pointer-events: auto`, the layer itself `pointer-events: none`.

- [ ] **Step 1: Write the failing tests**
```ts
import { describe, it, expect } from "vitest";
import { visibleRows, newestRows, cardHtml } from "@/app/canvas/overlayLogic";
describe("overlay logic", () => {
  it("visibleRows keeps in-viewport rows nearest centre first, capped", () => {
    const xs = new Float32Array([0, 1, 50, 2]), ys = new Float32Array([0, 1, 50, 2]); const proj = (x: number, y: number) => ({ x: x * 10, y: y * 10 });
    expect(visibleRows(xs, ys, proj, 100, 100, 2)).toEqual([0, 1]);   // row 2 is off-screen (500,500); cap 2 drops row 3
  });
  it("newestRows picks most recent createdAt among idx", () => { const p: any = { createdAt: [1, 5, 3, 9] }; expect(newestRows(p, [0, 1, 2, 3], 2)).toEqual([3, 1]); });
  it("cardHtml escapes and includes the X display minimum", () => {
    const meta: any = { title: ["<b>T</b>"], gist: ["g"], domain: ["ex.org"], url: ["https://ex.org"], role: ["evidence"] };
    const h = cardHtml(meta, 0, { grade: 3, provisional: true, url: "https://x.com/sigalor/status/1" });
    expect(h).toContain("&lt;b&gt;T&lt;/b&gt;"); expect(h).toContain("@sigalor"); expect(h).toContain('href="https://x.com/sigalor/status/1"'); expect(h).toContain("provisional");
  });
});
```
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**

```ts
// app/canvas/overlayLogic.ts
import type { MetaFile, PointsFile } from "@/lib/snapshot";
export function visibleRows(xs: Float32Array, ys: Float32Array, proj: (x: number, y: number) => { x: number; y: number }, w: number, h: number, max = 50): number[] {
  const rows: [number, number][] = [];
  for (let r = 0; r < xs.length; r++) { const p = proj(xs[r], ys[r]); if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) rows.push([r, (p.x - w / 2) ** 2 + (p.y - h / 2) ** 2]); }
  return rows.sort((a, b) => a[1] - b[1]).slice(0, max).map((r) => r[0]);
}
export function newestRows(p: PointsFile, idx: number[], k = 20): number[] { return idx.map((i, r) => [r, p.createdAt[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, k).map((r) => r[0]); }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function cardHtml(meta: MetaFile, i: number, point: { grade: number; provisional: boolean; url: string; date?: string }): string {
  return `<div class="card g${point.grade}${point.provisional ? " provisional" : ""}"><div class="t">${esc(meta.title[i] ?? "")}</div><div class="g">${esc((meta.gist[i] ?? "").slice(0, 200))}</div>
<div class="m">${meta.domain[i] ? `<span>${esc(meta.domain[i]!)}</span>` : ""}<span class="role">${esc(meta.role[i] ?? "")}</span>${point.provisional ? '<span class="prov">provisional</span>' : ""}</div>
<div class="x">Julian · @sigalor · <a href="${esc(point.url)}" target="_blank" rel="noopener">${esc(point.date ?? "open on X")}</a></div></div>`;
}
// app/canvas/CardOverlay.ts
import type { OverlayProxy } from "embedding-atlas"; import type { Snapshot } from "./useSnapshot"; import type { MetaFile } from "@/lib/snapshot"; import { visibleRows, newestRows, cardHtml } from "./overlayLogic";
type Props = { proxy: OverlayProxy; snap: Snapshot; idx: number[]; scale: number; xy: { x: Float32Array; y: Float32Array }; selected?: string; loadMeta: () => Promise<MetaFile> };
export class CardOverlay {
  private svg: SVGSVGElement; private cards: HTMLDivElement; private props: Props;
  constructor(private target: HTMLDivElement, props: Props) {
    this.props = props; target.style.pointerEvents = "none"; target.style.position = "absolute"; target.style.inset = "0";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%"); target.appendChild(this.svg);
    this.cards = document.createElement("div"); this.cards.className = "cards"; target.appendChild(this.cards); this.update(props);
  }
  update(props: Props) { this.props = props; const { proxy, snap, idx, scale, xy } = props; const n = idx.length;
    const rings: string[] = []; const newest = newestRows(snap.points, idx, 20); const path: string[] = [];
    for (let r = 0; r < n; r++) { const i = idx[r]; if (snap.points.provisional[i]) { const p = proxy.location(xy.x[r], xy.y[r]); rings.push(`<circle cx="${p.x}" cy="${p.y}" r="7" fill="none" stroke="#fff" stroke-opacity=".8"/>`); } }
    for (const r of [...newest].reverse()) { const p = proxy.location(xy.x[r], xy.y[r]); path.push(`${p.x},${p.y}`); rings.push(`<circle cx="${p.x}" cy="${p.y}" r="11" fill="none" stroke="#ffd966" stroke-opacity=".6"/>`); }
    this.svg.innerHTML = `<polyline points="${path.join(" ")}" fill="none" stroke="#ffd966" stroke-opacity=".25"/>${rings.join("")}`;
    if (scale >= 5 && snap.meta) { const rows = visibleRows(xy.x, xy.y, proxy.location, proxy.width, proxy.height, 50);
      this.cards.innerHTML = rows.map((r) => { const i = idx[r]; const p = proxy.location(xy.x[r], xy.y[r]); const date = new Date(snap.points.createdAt[i] * 1000).toISOString().slice(0, 10);
        return `<div style="position:absolute;left:${p.x + 10}px;top:${p.y - 10}px;pointer-events:auto;max-width:260px">${cardHtml(snap.meta!, i, { grade: snap.points.grade[i], provisional: !!snap.points.provisional[i], url: `https://x.com/sigalor/status/${snap.points.ids[i]}`, date })}</div>`; }).join("");
    } else { if (scale >= 5 && !snap.meta) props.loadMeta(); this.cards.innerHTML = ""; }
  }
  destroy() { this.target.innerHTML = ""; }
}
```
Pass `xy` from `Canvas.tsx` into the overlay props (`props: { snap, idx: data.idx, scale, xy: { x: data.x, y: data.y }, selected: url.sel, loadMeta }`). Add card CSS to `globals.css` (`.card{background:#15181d;border:1px solid #2a2f37;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.35} .card.g1{opacity:.7} .card.g0{opacity:.5} .card.provisional{border-style:dashed} .card .t{font-weight:600;margin-bottom:4px} .card .m{opacity:.7;margin-top:4px;display:flex;gap:8px} .card .x{opacity:.6;margin-top:4px} .card a{color:#9cc4ff}`).

- [ ] **Step 4: Run** → PASS; `pnpm typecheck`; visually confirm rings/cards at zoom in `pnpm dev`.
- [ ] **Step 5: Commit** — `git add app/canvas app/globals.css tests/unit/overlayLogic.test.ts && git commit -m "feat(canvas): DOM cards, provisional rings, arrival trail overlay"`

### Task 24: Top bar (lens picker, search, show-everything, grade slider) and filters panel

**Files:**
- Create: `app/canvas/TopBar.tsx`, `app/canvas/Filters.tsx`, `app/canvas/histogram.ts`, `tests/unit/histogram.test.ts`

**Interfaces:**
- `histogram.ts` (pure): `monthBins(createdAt: number[]): { key: number; label: string; count: number; start: number; end: number }[]` (UTC months, label `YYYY-MM`), `gradeBins(grade: number[]): number[4]`.
- `TopBar` props `{ url, setUrl, snap, onFlyTo(i: number) }`: lens `<select>` with each lens's purpose and "keeps / drops" line under it; search input → `GET /api/search?q=` → highlight (sets `url.q`, calls `onFlyTo(indexOf top hit)`; results list of 20 titles when meta loaded); "show everything" checkbox (`url.showAll`); grade slider 0–3 (`url.minGrade`); link "What is this?" opening a small about panel with the research question.
- `Filters` props `{ snap, filters, setFilters, url, setUrl, loadMeta }`: bottom strip with month histogram (log-scaled bar heights, click-drag selects `monthRange`), grade histogram, kind toggles, language toggles (languages from meta; triggers `loadMeta` on open). Filters dim rather than remove (implemented via mask → hidden; recorded simplification: hidden, since EmbeddingView has no per-point alpha; the grade alpha already dims).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { monthBins, gradeBins } from "@/app/canvas/histogram";
describe("histogram", () => {
  it("bins by UTC month with labels and ranges", () => {
    const t = (s: string) => Math.floor(Date.parse(s) / 1000);
    const b = monthBins([t("2026-09-01T00:00:00Z"), t("2026-09-30T23:59:59Z"), t("2026-10-05T00:00:00Z")]);
    expect(b.map((x) => [x.label, x.count])).toEqual([["2026-09", 2], ["2026-10", 1]]); expect(b[0].start).toBeLessThanOrEqual(t("2026-09-01T00:00:00Z")); expect(b[0].end).toBeGreaterThanOrEqual(t("2026-09-30T23:59:59Z"));
  });
  it("gradeBins counts 0..3", () => { expect(gradeBins([3, 3, 1, 0, 2])).toEqual([1, 1, 1, 2]); });
});
```
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement** `histogram.ts`:
```ts
export function monthBins(createdAt: number[]) { const m = new Map<number, number>(); for (const t of createdAt) { const d = new Date(t * 1000); const k = d.getUTCFullYear() * 12 + d.getUTCMonth(); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, count]) => { const y = Math.floor(k / 12), mo = k % 12; return { key: k, label: `${y}-${String(mo + 1).padStart(2, "0")}`, count, start: Date.UTC(y, mo, 1) / 1000, end: Date.UTC(y, mo + 1, 1) / 1000 - 1 }; }); }
export function gradeBins(grade: number[]) { const b = [0, 0, 0, 0]; for (const g of grade) b[Math.min(3, Math.max(0, Math.round(g)))]++; return b; }
```
Then `TopBar.tsx` and `Filters.tsx` as plain React components (no UI library; inline styles or `globals.css` classes; keyboard-accessible controls; `aria-label`s). Search handler:
```ts
const res: { xId: string; score: number }[] = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
const top = res[0] && snap.points.ids.indexOf(res[0].xId); if (top >= 0) onFlyTo(top); setResults(res);
```
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`; manual check in `pnpm dev`: switch lenses (animated), search flies, slider hides low grades, month drag filters.
- [ ] **Step 5: Commit** — `git add app/canvas tests/unit/histogram.test.ts && git commit -m "feat(canvas): top bar with lenses/search/relevance, filters with month histogram"`

### Task 25: Inspector panel and JSON Canvas export

**Files:**
- Create: `app/canvas/Inspector.tsx`, `app/canvas/export.ts`, `tests/unit/export.test.ts`

**Interfaces:**
- `export.ts`: `toJsonCanvas(points: PointsFile, meta: MetaFile, scale = 40): { nodes: any[]; edges: any[] }` — JSON Canvas 1.0: one `group` node per theme (bounding box of its points + padding, `label`), one `link` node per link post (`url`), one `text` node otherwise (`text` = title + gist), integer `x,y` = round(point × scale), `width 260 height 120`, ids = xId; no edges in v1.
- `Inspector` props `{ snap, xId, onClose, loadMeta }`: calls `loadMeta` on mount; shows card content, theme and leaf labels, grade + role + rationale, tags, sub-questions (text from `snap.labels.questions`), language, kind, date, "Open on X" link (display minimum), "Suggest a better label" link → `https://github.com/hermesloom/research-map/edit/main/data/label-overrides.json`, "Export JSON Canvas" button (downloads `research-map.canvas`).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { toJsonCanvas } from "@/app/canvas/export";
describe("toJsonCanvas", () => {
  it("emits groups per theme and link/text nodes with integer coordinates", () => {
    const points: any = { count: 2, ids: ["1", "2"], x: [0.26, 1.5], y: [0.1, -0.7], theme: [0, 0], leaf: [0, 0], kind: [1, 0], themes: [{ id: 0, label: "Theme A" }] };
    const meta: any = { title: ["T1", "T2"], gist: ["g1", "g2"], url: ["https://a.org", null] };
    const c = toJsonCanvas(points, meta, 100);
    const group = c.nodes.find((n) => n.type === "group"); expect(group.label).toBe("Theme A");
    const link = c.nodes.find((n) => n.id === "1"); expect(link.type).toBe("link"); expect(link.url).toBe("https://a.org"); expect(Number.isInteger(link.x)).toBe(true);
    expect(c.nodes.find((n) => n.id === "2").type).toBe("text");
  });
});
```
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**
```ts
// app/canvas/export.ts
import type { MetaFile, PointsFile } from "@/lib/snapshot";
export function toJsonCanvas(p: PointsFile, meta: MetaFile, scale = 40) {
  const nodes: any[] = []; const W = 260, H = 120;
  for (const t of p.themes) { const xs: number[] = [], ys: number[] = []; for (let i = 0; i < p.count; i++) if (p.theme[i] === t.id) { xs.push(p.x[i] * scale); ys.push(-p.y[i] * scale); } if (!xs.length) continue;
    const x0 = Math.round(Math.min(...xs)) - 40, y0 = Math.round(Math.min(...ys)) - 60; nodes.push({ id: `theme-${t.id}`, type: "group", label: t.label, x: x0, y: y0, width: Math.round(Math.max(...xs)) - x0 + W + 40, height: Math.round(Math.max(...ys)) - y0 + H + 40 }); }
  for (let i = 0; i < p.count; i++) { const base = { id: p.ids[i], x: Math.round(p.x[i] * scale), y: Math.round(-p.y[i] * scale), width: W, height: H };
    nodes.push(meta.url[i] ? { ...base, type: "link", url: meta.url[i] } : { ...base, type: "text", text: `**${meta.title[i]}**\n\n${meta.gist[i]}` }); }
  return { nodes, edges: [] };
}
```
`Inspector.tsx`: render as described; download via `URL.createObjectURL(new Blob([JSON.stringify(toJsonCanvas(...))], { type: "application/json" }))`.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`; manual check. **Step 5: Commit** — `git add app/canvas tests/unit/export.test.ts && git commit -m "feat(canvas): inspector panel and JSON Canvas export"`

### Task 26: Owner mode — login, overrides API, UI controls

**Files:**
- Create: `app/api/owner/login/route.ts`, `app/api/owner/override/route.ts`, `lib/ownerAuth.ts`, `app/canvas/OwnerControls.tsx`, `tests/unit/owner.test.ts`

**Interfaces:**
- `lib/ownerAuth.ts`: `ownerCookieValue(secret: string): string` = `sha256("owner:" + secret)`; `isOwner(request: Request): boolean` compares cookie `rm_owner` to `ownerCookieValue(env().OWNER_SECRET)` with constant-time compare.
- `POST /api/owner/login` body `{ secret }` → sets `rm_owner` cookie (HttpOnly, Secure, SameSite=Lax, 30 days) when it matches, else 401. `POST /api/owner/override` (owner only) body `{ type, xId?, clusterId?, questionId?, payload }` validated with zod (`type ∈ pin|renameLabel|moveLeaf|retireQuestion|trailEdit`) → inserts into `overrides`; for `retireQuestion` also sets `questions.validTo = now`; then calls `publishSnapshot` so the change is live within the CDN window; returns the new manifest. `GET /api/owner/override` → `{ owner: boolean }`.
- `OwnerControls.tsx`: rendered inside the Inspector when `owner` is true: "Pin here" (uses current point coords from the active terrain lens as payload), "Rename leaf label" (prompt), "Move to leaf…" (select from `points.leaves`), "Retire sub-question" (select). Login form appears from a hidden keyboard shortcut (`Shift+O` twice) to keep the public UI clean.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
beforeEach(() => { process.env.MONGODB_URI = "m"; process.env.OPENAI_API_KEY = "k"; process.env.OWNER_SECRET = "owner-pw"; vi.resetModules(); });
describe("owner auth", () => {
  it("login sets cookie only for the right secret", async () => {
    const { POST } = await import("@/app/api/owner/login/route");
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ secret: "nope" }) }))).status).toBe(401);
    const ok = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ secret: "owner-pw" }) })); expect(ok.status).toBe(200); expect(ok.headers.get("set-cookie")).toMatch(/rm_owner=.*HttpOnly/);
  });
  it("override route rejects non-owners and invalid bodies", async () => {
    vi.doMock("@/lib/db", () => ({ getDb: async () => ({}), collections: () => ({ overrides: { insertOne: async () => ({}) }, questions: { updateOne: async () => ({}) } }) })); vi.doMock("@/lib/publish", () => ({ publishSnapshot: async () => ({ count: 1 }) }));
    const { POST } = await import("@/app/api/owner/override/route"); const { ownerCookieValue } = await import("@/lib/ownerAuth");
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ type: "pin", xId: "1", payload: { x: 1, y: 2 } }) }))).status).toBe(401);
    const cookie = `rm_owner=${ownerCookieValue("owner-pw")}`;
    expect((await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ type: "explode" }) }))).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", headers: { cookie }, body: JSON.stringify({ type: "pin", xId: "1", payload: { x: 1, y: 2 } }) }))).status).toBe(200);
  });
});
```
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**
```ts
// lib/ownerAuth.ts
import { timingSafeEqual } from "node:crypto"; import { sha256 } from "./hash";
export const ownerCookieValue = (secret: string) => sha256("owner:" + secret);
export function isOwner(request: Request): boolean { const secret = process.env.OWNER_SECRET; if (!secret) return false;
  const m = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)rm_owner=([a-f0-9]{64})/); if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(ownerCookieValue(secret)); return a.length === b.length && timingSafeEqual(a, b); }
// app/api/owner/login/route.ts
import { ownerCookieValue } from "@/lib/ownerAuth";
export async function POST(request: Request) { const { secret } = await request.json().catch(() => ({})); const real = process.env.OWNER_SECRET;
  if (!real || typeof secret !== "string" || secret !== real) return new Response("unauthorized", { status: 401 });
  return new Response("ok", { status: 200, headers: { "Set-Cookie": `rm_owner=${ownerCookieValue(real)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` } }); }
// app/api/owner/override/route.ts
import { z } from "zod"; import { isOwner } from "@/lib/ownerAuth"; import { getDb, collections } from "@/lib/db"; import { publishSnapshot } from "@/lib/publish";
export const dynamic = "force-dynamic";
const Body = z.object({ type: z.enum(["pin", "renameLabel", "moveLeaf", "retireQuestion", "trailEdit"]), xId: z.string().optional(), clusterId: z.number().int().optional(), questionId: z.string().optional(), payload: z.record(z.string(), z.unknown()).default({}) });
export async function GET(request: Request) { return Response.json({ owner: isOwner(request) }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) { if (!isOwner(request)) return new Response("unauthorized", { status: 401 });
  const r = Body.safeParse(await request.json().catch(() => null)); if (!r.success) return new Response("bad request", { status: 400 });
  const db = await getDb(); const c = collections(db); await c.overrides.insertOne({ ...r.data, createdAt: new Date() } as any);
  if (r.data.type === "retireQuestion" && r.data.questionId) await c.questions.updateOne({ _id: r.data.questionId }, { $set: { validTo: new Date() } });
  const m = await publishSnapshot(db); return Response.json(m); }
```
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`; manual: log in, pin a point, confirm the map updates after reload.
- [ ] **Step 5: Commit** — `git add app/api/owner lib/ownerAuth.ts app/canvas/OwnerControls.tsx tests/unit/owner.test.ts && git commit -m "feat: owner mode with overrides that republish"`

### Task 27: Playwright smoke test (and 27B: deck.gl fallback, conditional)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/canvas.spec.ts`
- 27B (only if Task 22 Step 5 showed `EmbeddingView` fails without WebGPU): `app/canvas/CanvasFallback.tsx` real implementation, `pnpm add deck.gl@9`.

- [ ] **Step 1: Write the e2e test**
```ts
import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 1200, height: 800 } });
test("canvas renders, labels appear, search flies, lens switches", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/"); await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("combobox", { name: /lens/i })).toBeVisible();
  await page.getByRole("combobox", { name: /lens/i }).selectOption("question"); await page.waitForTimeout(800); expect(page.url()).toContain("lens=question");
  await page.getByRole("searchbox", { name: /search/i }).fill("category theory"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); expect(page.url()).toMatch(/v=/);
  expect(errors).toEqual([]);
});
```
`playwright.config.ts`: `baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000"`, `webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true }`, chromium only, `--enable-unsafe-webgpu --use-angle=swiftshader` launch args for headless WebGPU.

- [ ] **Step 2: Run** `pnpm exec playwright install chromium && pnpm test:e2e` against the dev fixture snapshot → PASS (if headless Chromium lacks WebGPU even with flags, run with `headless: false` locally and keep the test tagged `@local`; record this in `notes-webgpu.md`).
- [ ] **Step 3 (27B, conditional): deck.gl fallback** — implement `CanvasFallback.tsx` with `DeckGL` + `OrthographicView`, `ScatterplotLayer` (positions from the same `data.x/y`, `getFillColor` from `categoryColors()` parsed to RGBA), `TextLayer` for level 0/1 labels with `CollisionFilterExtension` and `getCollisionPriority: (l) => l.priority`, `sizeUnits: "pixels"`, `sizeMinPixels 12, sizeMaxPixels 36`; wire the same `viewportState` ↔ deck `viewState` (`target: [x, y]`, `zoom: log2(scale)`); no density mode, no DOM cards in the fallback (inspector still works via `onClick`). Render it when `!hasWebGPU()`.
- [ ] **Step 4: Commit** — `git add playwright.config.ts tests/e2e app/canvas && git commit -m "test: playwright smoke; fallback renderer decision recorded"`

---

## Phase 4 — Deployment and first data

### Task 28: Provision Vercel, Atlas, Blob, domain; run bootstrap and first layout

**Files:**
- Modify: `README.md` (deployment section), `docs/superpowers/plans/notes-webgpu.md` (append measured residual)

- [ ] **Step 1: MongoDB Atlas** — in the `henophilia` cluster create database `research_map` and a least-privilege user `research_map_app` with `readWrite` on that database only (Atlas UI → Database Access). Build `MONGODB_URI` with that user. Confirm the cluster tier supports Vector Search (M0 does; ≤ 3 indexes). Do **not** reuse the `vercel-admin-user-…` credentials in the app.
- [ ] **Step 2: X user-context credentials** — in console.x.com → app `x.nalenz.org` (33596273) → Keys and tokens → generate **Access Token and Secret** for @sigalor with Read permission. These become `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`; `X_CONSUMER_KEY`/`SECRET` are the app's consumer keys already supplied. Verify Owned Reads pricing applies after the first daily run by checking the console's usage page (expected ≤ $0.01 for a day with ≤ 10 posts); if it shows the standard rate, open the gap item in the spec.
- [ ] **Step 3: Vercel project** — `vercel link` (scope: the owner's team, new project `research-map`, connect GitHub repo `hermesloom/research-map`), create a Blob store in the dashboard and connect it to the project (OIDC variables are injected automatically), add env vars for Production + Preview with `vercel env add` for every key in `.env.example` (generate `CRON_SECRET` and `OWNER_SECRET` with `openssl rand -hex 24`), add `NEXT_PUBLIC_RESEARCH_QUESTION_POST_ID`. Add domain `research.nalenz.org` (`vercel domains add research.nalenz.org` then the CNAME at the DNS provider). `vercel env pull .env.local` for local work.
- [ ] **Step 4: GitHub secrets** — `gh secret set MONGODB_URI OPENAI_API_KEY CRON_SECRET` on `hermesloom/research-map`; create a fine-grained PAT with `contents: write` (for `repository_dispatch`) and set it as `GITHUB_DISPATCH_TOKEN` in Vercel; set `BLOB_READ_WRITE_TOKEN` as a GitHub secret only if the batch job ever writes to Blob (not in v1).
- [ ] **Step 5: Seed and bootstrap locally** —
```bash
pnpm seed:questions
pnpm bootstrap --file ~/x-nalenz-data/timeline-2026-11-01.json --stage all        # enrich → normalize → embed; watch the Firecrawl estimate; re-run until no progress
```
Expected: ≈ 1,214 items reach `embedded` (replies-to-others/retweets go straight to `graded`), `needsContent` on the photo-only posts that OCR found empty; `runs` has a `bootstrap` doc. Check `GET /api/status` locally (`pnpm dev`).
- [ ] **Step 6: First layout** — `cd batch && uv run research-map-batch run --dry-run` (prints cluster/noise/theme counts), then `uv run research-map-batch run`. Expected: layout v1 `published`, 5–9 themes, ~30–45 clusters, residual `None`. Then `pnpm bootstrap --stage grade` to place+grade everything, then trigger a publish: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest?force=1` (local) — this also performs the first real X call with `since_id` = newest stored id (expected 0–2 new posts, ≤ $0.01).
- [ ] **Step 7: Deploy** — push to `main`; Vercel builds; verify `https://research.nalenz.org/api/manifest` returns the snapshot, the canvas renders, cron appears in the Vercel dashboard (Settings → Cron Jobs). Next morning: check `/api/status` for the daily run; check console.x.com usage for the billed amount.
- [ ] **Step 8: Measure** — after the first week run `research-map-batch run` once more by hand (`workflow_dispatch`) and record the measured `procrustesResidual` and the number of reused labels in `batch/README.md`. Commit: `git commit -am "docs: first re-layout measurements"`.

---

## Self-review notes (filled in by the plan author)

- **Spec coverage:** §1–3 → header + Task 1; §4 data model → Tasks 2–3, lenses → 21, trails → 19, overrides → 13/26; §5.1 ingest → 5/14, enrich → 6–8/14, normalize → 9, embed → 10, place → 11, grade → 12, publish → 13, Workflow escape hatch → noted in 14 (not built, by design); §5.2 batch → 17–20 (thumbnail resizing deferred: Task 8 ships originals; `batch/thumbs.py` removed from scope); §5.3 bootstrap → 16; §6 renderer/fallback → 22/27, zoom bands → 22/23 (image labels), relevance rendering → 21 (alpha + mask), arrivals → 23, lens switching → 22, inspector → 25, search → 15/24 (server-side, amendment 1), filters → 24, export → 25, owner mode → 26; §7 error handling → 14/15/20; §8 testing → every task + 27; §9 repo → 1/20; §10–12 → 28.
- **Known simplifications recorded as amendments 1–4 above plus:** filters hide rather than dim (EmbeddingView has no per-point alpha); thumbnails are originals; trail notes empty.
- **Type consistency check:** `Label.content` (not `text`) everywhere on the client; `LayoutLabel.text` on the server is mapped to `content` in `buildSnapshot`; `Stage` order identical in `types.ts`, `stages.ts`, and tests; `Fetched.source` ∈ `EnrichSource`; `KINDS` index order identical in `snapshot.ts` and `colors.ts` consumers.
