# research-map batch job

Computes the layout of research.nalenz.org: warm-started, Procrustes-aligned 2-D UMAP; 10-D clustering space + HDBSCAN; cluster matching with label reuse; Clio-style LLM naming and themes; sub-question regrowth; trails. Writes a versioned layout to MongoDB (published only if the Procrustes residual ≤ 0.10).

```bash
uv sync
uv run pytest -q
MONGODB_URI=... OPENAI_API_KEY=... uv run research-map-batch run --dry-run
```

Runs on GitHub Actions (`.github/workflows/batch.yml`) by `workflow_dispatch` or `repository_dispatch` (`relayout`).

## Measurements

(filled in after the first re-layout: residual, reused labels)
