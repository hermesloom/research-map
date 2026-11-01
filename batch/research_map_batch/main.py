import argparse
import os
import sys
import numpy as np
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
    client = OpenAI()
    model = os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.4-mini")

    def llm(prompt, schema):
        r = client.responses.parse(model=model, input=[{"role": "user", "content": prompt}], text_format=schema)
        return r.output_parsed

    def embed(texts):
        r = client.embeddings.create(model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-large"), dimensions=int(os.environ.get("EMBEDDING_DIMS", "1024")), input=texts)
        return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]

    return llm, embed


def cli():
    ap = argparse.ArgumentParser(prog="research-map-batch")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="compute and write a new layout version")
    r.add_argument("--seed", type=int, default=42)
    r.add_argument("--threshold", type=float, default=0.10)
    r.add_argument("--force-publish", action="store_true")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--skip-questions", action="store_true")
    r.add_argument("--no-reuse", action="store_true", help="ignore previous cluster labels (re-name everything)")
    a = ap.parse_args()
    db = connect()
    llm, embed = make_llm()
    ids, E = load_vectors(db)
    print(f"{len(ids)} vectors", file=sys.stderr)
    if len(ids) < 20:
        print("too few vectors", file=sys.stderr)
        sys.exit(1)
    prev = load_published_layout(db)
    prev_arg = {"ids": [p["xId"] for p in prev["points"]], "xy": [[p["x"], p["y"]] for p in prev["points"]]} if prev else None
    lay = run_layout(ids, E, prev_arg, seed=a.seed)
    print(f"residual={lay['residual']}", file=sys.stderr)
    raw = cluster(lay["x10"])
    mapping, reused = match_clusters(raw, ids, prev["points"] if prev else [], prev["clusters"] if prev else [])
    if a.no_reuse:
        reused = {}
    stable = np.array([mapping[int(l)] for l in raw])
    print(f"clusters={len(set(stable.tolist()) - {-1})} noise={np.mean(stable == -1):.1%} reused={len(reused)}", file=sys.stderr)
    norm = load_normalized(db)
    texts = {i: f"{norm.get(i, {}).get('title', '')}: {norm.get(i, {}).get('summaryEn', '')}" for i in ids}
    clusters, themes = label_all(ids, E, texts, stable, reused, llm, embed)
    layout = assemble_layout(ids, lay["xy"], stable, clusters, themes, make_hulls(lay["xy"], stable), None if a.force_publish else lay["residual"], prev["version"] if prev else 0, threshold=a.threshold)
    if a.dry_run:
        print({k: (v if k not in ("points", "labels", "hulls") else len(v)) for k, v in layout.items()})
        return
    write_layout(db, layout)
    print(f"wrote layout v{layout['version']} status={layout['status']}", file=sys.stderr)
    if layout["status"] == "published" and not a.skip_questions:
        print(f"questions inserted: {regrow(db, llm, embed)}; trails: {rebuild_trails(db)}", file=sys.stderr)
