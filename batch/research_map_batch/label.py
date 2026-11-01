import os
import json
import numpy as np
from pydantic import BaseModel
from sklearn.cluster import KMeans

QUESTION = "How can we make the structures through which humans coordinate their lives explicit, understandable, interoperable, and changeable, without requiring everyone to agree on one universal representation of reality?"


class ClusterName(BaseModel):
    label: str
    description: str


class ThemeName(BaseModel):
    label: str
    description: str


def pick_examples(E, idx_in, idx_out, n_in=20, n_out=10):
    """Clio-style exemplars: closest-to-centroid inside the cluster, nearest outsiders for contrast."""
    En = E / np.linalg.norm(E, axis=1, keepdims=True)
    cen = En[idx_in].mean(0)
    order_in = idx_in[np.argsort(-(En[idx_in] @ cen))][:n_in]
    if len(idx_out) == 0:
        return order_in.tolist(), []
    order_out = idx_out[np.argsort(-(En[idx_out] @ cen))][:n_out]
    return order_in.tolist(), order_out.tolist()


def name_cluster(texts_in, texts_out, llm):
    prompt = (
        f"Research question of the author: {QUESTION}\n\nPosts IN the cluster:\n" + "\n".join(f"- {t[:300]}" for t in texts_in)
        + "\n\nPosts NEAR but NOT in the cluster (do not describe these):\n" + "\n".join(f"- {t[:200]}" for t in texts_out)
        + "\n\nName the cluster: a 2-5 word specific English Title Case label (no punctuation) that distinguishes the in-cluster posts from the nearby ones, plus a one-sentence description."
    )
    return llm(prompt, ClusterName)


def build_themes(cluster_labels, label_vectors, llm, k=None):
    """Group leaf labels into 5–9 themes by k-means on label embeddings; the LLM names each theme."""
    cids = sorted(cluster_labels)
    n = len(cids)
    if n == 0:
        return []
    k = k or int(min(9, max(5, round(n ** 0.5))))
    k = min(k, n)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(label_vectors)
    themes = []
    for t in range(k):
        members = [cids[i] for i in range(n) if km.labels_[i] == t]
        if not members:
            continue
        prompt = (
            f"Research question: {QUESTION}\n\nThese topic labels belong together on a map:\n" + "\n".join(f"- {cluster_labels[c]}" for c in members)
            + "\n\nGive a 3-6 word Title Case theme name covering all of them and a one-sentence description."
        )
        name = llm(prompt, ThemeName)
        themes.append({"id": len(themes), "label": name.label, "description": name.description, "clusterIds": members})
    return themes


def _overrides():
    p = os.environ.get("LABEL_OVERRIDES", os.path.join(os.path.dirname(__file__), "..", "..", "data", "label-overrides.json"))
    try:
        return {int(k): v for k, v in json.load(open(p)).items()}
    except FileNotFoundError:
        return {}


def label_all(ids, E, texts, stable_labels, reused, llm, embed):
    """Owner overrides > reused labels > LLM naming. Returns (clusters by id, themes)."""
    ov = _overrides()
    clusters = {}
    for k in sorted(set(stable_labels.tolist()) - {-1}):
        idx_in = np.where(stable_labels == k)[0]
        idx_out = np.where((stable_labels != k) & (stable_labels != -1))[0]
        if k in ov:
            label, desc = ov[k], ""
        elif k in reused and reused[k]:
            label, desc = reused[k], ""
        else:
            a, b = pick_examples(E, idx_in, idx_out)
            nm = name_cluster([texts[ids[i]] for i in a], [texts[ids[i]] for i in b], llm)
            label, desc = nm.label, nm.description
        clusters[int(k)] = {"id": int(k), "label": label, "description": desc, "size": int(len(idx_in))}
    labels = {k: v["label"] for k, v in clusters.items()}
    vecs = np.asarray(embed([labels[k] for k in sorted(labels)])) if labels else np.zeros((0, 1))
    themes = build_themes(labels, vecs, llm)
    for t in themes:
        for c in t["clusterIds"]:
            clusters[c]["themeId"] = t["id"]
    return clusters, themes
