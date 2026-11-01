# research.nalenz.org

A living map of every post on [@sigalor](https://x.com/sigalor), organized automatically around one research question:

> How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?

Every post has one identity and lives in several lenses (topic terrain, distance from the question, time strata). New posts are fetched once a day and placed next to their semantic neighbours without moving the rest of the map.

## How it works

Three runtimes share one MongoDB Atlas database and one Vercel Blob store; the browser reads only from Blob.

1. **Next.js app on Vercel** — the canvas (Apple Embedding Atlas, WebGPU), a manifest route, and a daily cron route.
2. **Daily TypeScript pipeline** (inside the cron) — ingest → enrich → normalize → embed → place → grade → publish. Idempotent and resumable.
3. **Python batch job on GitHub Actions** — warm-started, Procrustes-aligned layout, clustering, hierarchical LLM labels with reuse, sub-question tree, trails. Writes versioned layouts.

Design: `docs/superpowers/specs/2026-11-01-research-map-design.md`. Plan: `docs/superpowers/plans/2026-11-01-research-map.md`.

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in secrets
pnpm dev
pnpm test                    # unit tests (integration tests run when MONGODB_URI_TEST is set)
pnpm typecheck
```

## Batch job

```bash
cd batch && uv sync && uv run research-map-batch run --dry-run
```

## Data notice

Post content belongs to the author. Snapshots, vectors and enrichment live in MongoDB and Vercel Blob, never in this repository. Code is MIT licensed.

## Deployment

- **Vercel**: project `research-map` on team `hermesloom`; production domain `research.nalenz.org` (CNAME at the DNS provider → Vercel). Env vars live in the Vercel project; `vercel env pull .env.vercel --environment development` fetches them locally. A Blob store (`research-map-canvas`) is connected to the project (OIDC inside Vercel, `BLOB_READ_WRITE_TOKEN` elsewhere).
- **Daily cron**: `vercel.ts` schedules `GET /api/cron/ingest` at 04:00 UTC; the route checks `CRON_SECRET`. `?force=1` republishes without new posts.
- **Batch re-layout**: GitHub Actions `batch-relayout` (manual, or `repository_dispatch: relayout` sent by the cron when provisional posts exceed the threshold). Needs repository secrets `MONGODB_URI`, `OPENAI_API_KEY`, `CRON_SECRET`.
- **First-time data**: `pnpm seed:questions`, then `pnpm bootstrap --file <timeline export> --stage all`, then `cd batch && uv run research-map-batch run`, then `pnpm bootstrap --stage grade`, then `curl -H "Authorization: Bearer $CRON_SECRET" https://research.nalenz.org/api/cron/ingest?force=1`.
- **Owner mode**: press Shift+O twice on the map, enter `OWNER_SECRET`.
