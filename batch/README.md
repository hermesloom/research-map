# research-map batch job

Computes the layout of research.nalenz.org: warm-started, Procrustes-aligned 2-D UMAP; 10-D clustering space + HDBSCAN; cluster matching with label reuse; Clio-style LLM naming and themes; sub-question regrowth; trails. Writes a versioned layout to MongoDB (published only if the Procrustes residual ≤ 0.10).

```bash
uv sync
uv run pytest -q
MONGODB_URI=... OPENAI_API_KEY=... uv run research-map-batch run --dry-run
```

Runs on GitHub Actions (`.github/workflows/batch.yml`) by `workflow_dispatch` or `repository_dispatch` (`relayout`).

## Measurements

| Date | Layout | Points | Clusters / noise | Procrustes residual vs previous | Labels reused | Note |
|---|---|---|---|---|---|---|
| 2026-11-01 | v1 | 1,229 | 40 / 30.6% | – (first) | 0 | initial bootstrap layout |
| 2026-11-01 | v2 | 1,229 | 40 / 30.6% | 0.087 | 0 (`--no-reuse`, renamed everything with the contrastive prompt) | warm-started from v1 with the same seed; passes the 0.10 gate but is higher than the experiment's re-seed disparity (0.015–0.035), so the gate value is not generous |
