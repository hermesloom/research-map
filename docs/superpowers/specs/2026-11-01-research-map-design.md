# research.nalenz.org — design spec

Date: 2026-11-01
Status: approved in conversation (brainstorming, architectural path); awaiting written review
Repo: `hermesloom/research-map` · Hosting: Vercel (Hobby) · Data: MongoDB Atlas + Vercel Blob
Research backing this spec: `~/x-nalenz-data/reports/Research map canvas design.md` and the six notes in `~/x-nalenz-data/research_notes/Research map canvas design/` (incl. a live clustering experiment on the real corpus).

## 1. Purpose

One large zoomable canvas that shows every post of the X account @sigalor (user id `1852658982608846848`), organized automatically around the core research question:

> How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?

Whenever a new post appears on X, it is fetched at most once a day, enriched, and placed at a suitable, **stable** position on the canvas. Visitors explore; the owner curates. The site is open source.

### Success criteria

- A visitor can, without instruction, see the 5–9 big themes at a glance, zoom into a leaf topic, and read any post with its source.
- A new post is visible on the map within ~24 h of posting, at a position next to its semantic neighbours, without the rest of the map moving.
- The X API costs less than ~$0.50/month; total running cost under ~$1/month on free tiers.
- The map itself embodies the question: a post has one identity but lives in several lenses; no lens is presented as the one true representation.

### Non-goals (v1)

Replies to other people (1,065 posts), multi-user accounts, editing or deleting posts via the site, visitor comments, any visitor write path except "suggest a better label" (pull request).

## 2. The corpus (facts that shaped the design)

Snapshot 2025-02-19 → 2026-11-01 saved at `~/x-nalenz-data/timeline-2026-11-01.json` (2,301 posts). After dropping 22 retweets and 1,065 replies to others: **1,214 own posts** — 653 link posts, 349 text, 139 media, 69 self-replies, 4 quotes. 141 bare URLs have no title at all; 46 posts are photo-only with no text; 67 posts are German; 44% of posts were written in Sep–Oct 2026.

Experiment findings that are now requirements:

| Finding | Consequence |
|---|---|
| Embedding raw posts: untitled URLs clustered by URL shape; photo-only posts formed fake clusters the LLM labeled "core"; Wikipedia links formed their own continent; German formed one language island | **Normalize first**: every post gets a fetched/OCR'd content excerpt and a one-sentence English summary; the summary is what gets embedded |
| HDBSCAN on the 2-D map found only 3 clusters; 37 clusters/7 themes appeared only in a separate 10-D clustering space, with 25% "noise" | Cluster in a higher-dimensional space, not on the display layout; granularity is a hierarchy, not a truth |
| Noise posts have *higher* mean relevance to the question than the corpus | Unclustered posts are never hidden |
| Re-seeded full layouts: Procrustes disparity 0.015–0.243 (whole islands occasionally move) | Coordinates are persisted, versioned, append-only; re-layouts are rare, warm-started, aligned, animated |
| Placing held-out posts by averaging neighbours' coordinates: 44% correct; `umap.transform`: 72% | Daily placement = snap to nearest neighbour (+ deterministic jitter), never averaging |
| Cluster-level LLM relevance rating: 57% of posts "core" | Grade relevance per post, 0–3, with hand-labeled anchors and a rationale |

## 3. Architecture (approach B)

Three runtimes, one database, one blob store; the browser reads only from Blob.

```
X API ──(daily, since_id)──▶ Vercel cron (TypeScript)
                              ingest → enrich → normalize → embed → place → grade → publish
                                      │                                         │
                                      ▼                                         ▼
                               MongoDB Atlas (M0)                      Vercel Blob (immutable snapshots)
                                      ▲                                         │
                                      │ vectors / layouts                       ▼
GitHub Actions (Python, manual or threshold-triggered)             Next.js canvas (Embedding Atlas)
  warm-started aligned layout · clustering · labels · question tree
```

Why two runtimes: parametric/aligned UMAP, density-layer clustering and the labeling libraries are Python-only; the daily path must be cheap, idempotent TypeScript on Vercel. The experiment harness already exists in Python.

## 4. Data model (MongoDB)

Principle: **a post has exactly one identity and lives in many places.** Everything that organizes posts is data layered on top, versioned, never baked into a single layout.

| Collection | Contents |
|---|---|
| `items` | Immutable X post: `xId`, `text` (note_tweet text if present), `createdAt`, `kind` ∈ {text, link, media, selfReply, quote}, `urls[]` with X's unwound metadata, `mediaKeys[]`, `parentId` for self-replies, `lang`, `publicMetrics`, `deletedAt` tombstone, `stage` marker (see §5), `isResearchQuestion` flag |
| `enrichment` | Per item: `source` ∈ {wikipedia, oembed, arxiv, openalex, github, firecrawl, wayback, thin}, fetched `title`, `excerpt`, `ogImage`; for images `transcript`, `description`, `thumbUrl` (Blob), `originalMediaUrl`; LLM normalization `{title, summaryEn, gist, tagsEn[], language, entities[], contentKind}`; `needsContent` flag when nothing could be obtained |
| `vectors` | `itemId`, `embedding` (1,024-d, `text-embedding-3-large` with `dimensions=1024`), `model`, `inputHash`. One Atlas vector index; queries use `exact: true` |
| `facets` | `name`, `purpose`, `hierarchical: bool`, `authority` ∈ {curated, llmProposed, embeddingDerived}, `version`, `values[]` (with optional `parent`) |
| `assignments` | `itemId`, `facetId`, `value`, `confidence`, `provenance`, `version`. Covers taxonomy, free tags and cluster membership with one schema |
| `questions` | Core question + sub-question tree: `text`, `parentId`, `embedding`, `validFrom`, `validTo`, `origin` ∈ {seed, induced, curated}. Seed top level: explicit · understandable · interoperable · changeable · without universal agreement · who audits and trusts it |
| `relations` | `itemId`, `questionId`, `role` ∈ {evidence, example, counterexample, tool, inspiration, extension, tangent, unrelated}, `grade` 0–3, `rationale`, `cosine`, `modelVersion`, `disagreement: bool` |
| `layouts` | Versioned: `version`, `createdAt`, `method`, `points: {itemId, x, y, clusterId, provisional}`, `procrustesResidual`, `status` ∈ {draft, published}, `labels[]` (`{level, text, x, y, priority, clusterId}`), `hulls[]` |
| `lenses` | `name`, `primaryLayout` ∈ {topicTerrain, questionRadial, timeStrata}, `colorFacet`, `hullFacet`, `preserves[]`, `drops[]`, `purpose` |
| `trails` | `name`, `questionId`, `steps: [{itemId, note, position}]`, `authority` |
| `overrides` | Owner curation: pinned coordinates, label renames, cluster moves, retired questions — all with `provenance: curated`; applied after every re-layout |
| `runs` | Per daily/batch run: counts per stage, API usage/costs where reported, errors, duration |
| `manifest` | Single doc: `latestPointsUrl`, `latestMetaUrl`, `labelsUrl`, `layoutVersion`, `generatedAt`, `count`, `embeddingModel` |

### Lenses (v1)

1. **Topic terrain** (home): the 2-D layout; density contours at low zoom; labels level 0 = themes (≈7), level 1 = leaf topics (≈37), level 2 = item titles.
2. **Question lens**: angle from the terrain layout, radius = inverse relevance grade; the core question sits at the centre, unrelated posts at the rim.
3. **Time strata**: date × sub-question, log-scaled month bins.

Secondary facets never move points; they render as colour, hulls or badges. Items keep identity and animate between lenses.

## 5. Pipeline

### 5.1 Daily job (Vercel cron, TypeScript)

Route `GET /api/cron/ingest`, `force-dynamic`, requires `Authorization: Bearer ${CRON_SECRET}`. Scheduled once a day (Hobby: ±59 min jitter, no retries, possible double invocation) — therefore every stage is **idempotent and resumable** via a per-item `stage` marker: `ingested → enriched → normalized → embedded → placed → graded`. A run processes whatever is behind, in that order, then publishes.

1. **Ingest** — `GET /2/users/{id}/tweets?since_id=<newest stored xId>` with `tweet.fields=created_at,entities,attachments,referenced_tweets,lang,public_metrics,note_tweet`, `expansions=attachments.media_keys`, `media.fields=url,preview_image_url,type,alt_text`, **no** `author_id` expansion. **User-context OAuth 2.0 token** (so reads bill as Owned Reads, $0.001/post; an empty response bills $0). Upsert on unique `xId`. Watermark = newest stored id (catches up missed days). Weekly: re-check the last 30 days of ids and set `deletedAt` on anything gone from X (X policy: sync deletions within 24 h). Never more than one timeline request per day except pagination of a genuinely new backlog.
2. **Enrich** — host router before any paid call: Wikipedia REST `page/summary` (en/de, custom User-Agent) → YouTube oEmbed → arXiv API → OpenAlex (DOIs) → GitHub API + raw README → Firecrawl `/v2/scrape` `formats:["markdown","summary"]`, PDFs `parsers:[{type:"pdf",maxPages:5}]` → paywall (401/402/403 or sub-300-char page) → DOI→OpenAlex → dead → Wayback availability API → `thin` record (domain + path tokens + post text). Images: vision model (`detail: high`) → strict JSON `{transcript, kind, description, title, tags}`; re-host to Blob with 512-px thumbnail, keep original URL. All fetch results cached in `enrichment`; nothing is scraped twice. Firecrawl quota exhaustion defers, never fails.
3. **Normalize** — one strict-JSON LLM call per post → `{title, summaryEn, gist, tagsEn, language, entities, contentKind}`. Self-replies get parent text as context. **Guard:** no text and no OCR result ⇒ no call, no vector, `needsContent: true`. The research-question post is flagged and excluded from ranking. Invalid JSON retries once, then waits for the next run.
4. **Embed** — `summaryEn` (+ title) with `text-embedding-3-large`, `dimensions=1024`. Model pinned in the manifest; changing it means a full re-embed + re-layout.
5. **Place** — exact `$vectorSearch` (k=10) over items in the published layout. Coordinates = nearest neighbour's `(x, y)` + deterministic jitter hashed from `xId` (≈ 0.3 × median NN spacing). Leaf cluster = majority vote of the 10, tie broken by cosine to the cluster's name vector. `provisional: true`. Never a coordinate average.
6. **Grade** — one LLM call per post (temperature 0) against the core question and the 3 nearest sub-questions: `grade` 0–3 (UMBRELA-style rubric), `role`, one-line `rationale`. Prompt carries ~30 owner-labeled anchors (core/adjacent/unrelated). Store cosine too; set `disagreement` when grade and cosine disagree strongly.
7. **Publish** — write immutable `canvas/<timestamp>/points.json` (columnar: ids, x, y, leaf, grade, provisional, createdAt — a few hundred KB), `meta.json` (titles, gists, URLs, thumbs — lazy), `labels.json`, `hulls.json` to **public Vercel Blob**; upsert `manifest`. `GET /api/manifest` serves it with `s-maxage=300, stale-while-revalidate=86400`. `GET /api/posts?since=` returns a delta. The browser never queries Mongo. Hard limit respected: Vercel function bodies ≤ 4.5 MB.

Escape hatch if a run approaches 300 s: wrap the same stage functions in Vercel Workflow steps (included on Hobby; per-step retries). Not Pro.

### 5.2 Batch job (Python, GitHub Actions `workflow_dispatch`)

Triggered manually, or by the daily job via `repository_dispatch` when provisional share > 8% (configurable). Not on a schedule (public-repo schedules auto-disable after 60 idle days).

1. Load all vectors + previous published layout from Atlas.
2. Clustering space: UMAP/PaCMAP to 10–20 d. Display layout: 2-D UMAP/PaCMAP **warm-started** (`init=` previous coordinates, provisional points at their placed positions), then **Procrustes-aligned** (rotation/reflection/scale) to the previous layout over shared ids; record residual.
3. Cluster the high-d space (HDBSCAN `min_cluster_size≈8` / EVoC layers). Match new clusters to old by Jaccard overlap of members; **reuse labels at ≥ 0.7**. LLM-name only new/split/merged clusters (Clio recipe: in-cluster + contrastive samples → name; names → themes). Target ≈ 5–9 themes.
4. Regrow the sub-question tree from rationales of grade-2/3 posts; version old questions out (`validTo`), never delete.
5. Compute alpha-shape hulls per leaf, label positions/priorities (priority = member count × mean grade), and a 2048² thumbnail sprite atlas.
6. Write a new `layouts` version. **Gate:** if `procrustesResidual` > 0.10 (configurable; normal re-layouts measured 0.015–0.035, a bad one 0.243), save as `draft` and post a summary for owner approval; otherwise `published`. Apply `overrides`. Clear `provisional`. The next daily publish ships it; the canvas animates old → new.

### 5.3 Backlog bootstrap (one-off script, no X API)

Runs §5.1 steps 2–7 over the 2,301 saved posts (own posts + self-replies; replies-to-others stored but `kind: replyToOther`, excluded from layout), using OpenAI Batch API where possible, then §5.2 once. Firecrawl free tier (1,000 credits/month) covers ≈ 400–800 credits if spread over two cycles; otherwise one $19 month.

## 6. Canvas UI

**Renderer:** `embedding-atlas/react` `EmbeddingView` (MIT, WebGPU), client-only (`next/dynamic`, `ssr:false`). **Fallback decided now:** deck.gl 9.4 WebGL2 `ScatterplotLayer` + `TextLayer` + `CollisionFilterExtension`. WebGPU availability verified on day one. Excluded for license: Cosmograph UI (CC-BY-NC), deepscatter (NC), tldraw (paid key).

**Page:** full-viewport canvas; slim top bar (lens picker, search, "show everything" toggle); collapsible right inspector; collapsible bottom month-histogram scrubber.

**Zoom bands (topic terrain):**

| Band | Rendering |
|---|---|
| z0 whole map | density contours, 7 theme labels, faint dots |
| z1 region | points coloured by leaf, 37 leaf labels, hull on hover |
| z2 neighbourhood | sprite-atlas thumbnails, item titles |
| z3 close-up | DOM cards (≤ ~50 in view) via `customOverlay`: title, gist, favicon, date, grade badge, X permalink |

Labels come from the batch job as `Label{x,y,text,level,priority}`; Embedding Atlas's own keyword labels are not used.

**Relevance rendering:** grade 3 full colour · 2 normal · 1 desaturated · 0 near-transparent and hidden unless "show everything". Threshold is a slider, default persisted in the URL. Unclustered posts are ordinary points.

**Arrivals:** newest N get a halo and a tween from their nearest neighbour's position; a faint polyline threads the last 20 arrivals; provisional posts render as hollow rings; a re-layout animates every point old → new.

**Lens switching:** identity-preserving animation; each lens shows its purpose line and what it drops.

**Inspector:** card content + every place the item lives (theme/leaf, facet values, sub-questions with role + rationale, trails, language, kind) + "suggest a better label" → pre-filled GitHub PR. X display minimum on every card: name + @handle, unaltered text, timestamp → permalink.

**Search:** embed query → cosine rank against shipped vectors in-browser → fly camera (`viewportState`) to top hit, highlight top 20; query in URL.

**Filters:** month histogram (log-scaled), grade histogram, kind, language — dim, don't remove.

**Export:** JSON Canvas 1.0 (group per theme, node per post).

**Owner mode:** single owner secret; unlocks pin item, rename label, move cluster membership, retire sub-question, edit trail. Stored in `overrides`, survive re-layouts.

## 7. Error handling

- Idempotent, resumable stages (§5.1); double invocations and crashes cause neither duplicates nor gaps.
- Enrichment never blocks: fallback ladder ends in a `thin` record rendered as a bare chip.
- LLM outputs schema-validated; empty-input guard prevents placeholder vectors.
- Every run logged to `runs`; `GET /api/status` exposes the last run (Hobby keeps 1 h of logs).
- Batch layout gated on Procrustes residual; drafts need owner approval.
- Label reuse logged per cluster.
- Secrets only in Vercel env / GitHub Actions secrets: `MONGODB_URI` (least-privilege user), `OPENAI_API_KEY`, `X_USER_TOKEN` (+ refresh), `FIRECRAWL_API_KEY`, `CRON_SECRET`, `OWNER_SECRET`, `BLOB_READ_WRITE_TOKEN` (Actions only). Fork PRs cannot read them (Vercel Git Fork Protection).

## 8. Testing

- Unit (TS): host router selection, fallback ladder, normalization schema, placement (snap + jitter), stage state machine, manifest generation, grade/cosine disagreement rule.
- Fixture tests for every enrichment adapter with recorded responses; no live network.
- Golden test (Python): experiment embeddings as fixture; assert cluster purity and Procrustes residual within bounds; assert label reuse at ≥ 0.7 Jaccard.
- End-to-end: full daily job against local Mongo with fixture posts and a mocked X response; assert published files + manifest.
- Browser smoke (Playwright): canvas renders points, labels appear per zoom band, search flies camera, lens switch animates.
- **The X API is never called in tests.**

## 9. Repository

```
app/                      Next.js 16 App Router
  (canvas)/               client-only canvas page
  api/                    manifest, posts delta, cron/ingest, status
lib/                      pipeline stages, enrichment adapters, placement, grading, publish
batch/                    Python: layout, clustering, labeling, question tree, hulls, atlas
scripts/                  backlog bootstrap, anchor-labeling helper
tests/                    TS unit + fixtures; Python tests
docs/superpowers/specs/   this spec
.github/workflows/        batch job (manual + repository_dispatch)
```

License: MIT (code). Post data and snapshots live in Mongo/Blob, not git, under a separate data notice. Vercel for GitHub deploys `main`; domain `research.nalenz.org` attached to the project; Hobby plan (non-commercial).

## 10. Costs

| Item | One-off (backlog) | Ongoing |
|---|---|---|
| X API (owned reads, daily since_id) | $0 (already exported) | ≈ $0.15–0.30/month; $0 on empty days |
| Free host APIs | $0 | $0 |
| Firecrawl | $0 on free tier (two cycles) or $19 once | ≈ 45 credits/month, $0 |
| Vision OCR (144 images) | ≈ $0.25–0.85 | ≈ $0.10/month |
| Normalization | ≈ $1–4 | ≈ $0.10–0.25/month |
| Embeddings | ≈ $0.01 (measured) | < $0.01 |
| Labels + hierarchy | ≈ $0.30–0.50 | ≈ $0.10–0.30 per re-layout |
| Relevance grading + tree | ≈ $0.50 | < $0.05/month |
| Vercel Hobby, Atlas M0, GitHub Actions | $0 | $0 |
| **Total** | **≈ $2–6 (≈ $21–25 with a Firecrawl month)** | **≈ $0.50–1/month** |

## 11. Decisions taken (owner-approved 2026-11-01)

- Approach B (incremental placement + rare aligned re-layouts) over nightly rebuild (A) or TypeScript-only (C).
- Corpus v1 = own posts + self-reply threads; replies to others stored but excluded.
- Personal/off-topic posts kept, rendered faint, hidden by default below the grade threshold, with a "show everything" toggle.
- Embed the English summary; language is a facet overlay.
- Embedding model pinned: `text-embedding-3-large`, 1,024 dims.
- Home lens = topic terrain; question lens second; time strata third.
- User-context X token; weekly deletion reconciliation.
- Images re-hosted to Blob, original URL kept.
- Plain Atlas URI with least-privilege user (portable ownership).
- Renderer Embedding Atlas; deck.gl fallback pre-decided.

## 12. Open items to measure in the first month

- Warm-start re-layout residual on this corpus (harness exists).
- Toponymy/EVoC density hierarchy vs Clio LLM loop: which yields names the owner recognizes.
- Embedding Atlas behaviour without WebGPU.
- Whether Owned Reads apply to the chosen token (budget assumes yes; worst case 5×, still < $1.50/month).
- Vision model choice: run 20 German screenshots through gpt-5.4-nano / gpt-5.4-mini / gpt-5.6-luna.
