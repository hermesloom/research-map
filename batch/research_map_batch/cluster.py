import numpy as np
import hdbscan


def cluster(x10, min_cluster_size=8, min_samples=3):
    """HDBSCAN (eom) on the clustering space; -1 = noise (kept on the canvas, never hidden)."""
    return hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples, cluster_selection_method="eom").fit(x10).labels_


def match_clusters(new_labels, ids, prev_points, prev_clusters, threshold=0.7):
    """Map fresh HDBSCAN ids to stable ids. A new cluster inherits a previous id (and label) when the Jaccard overlap of
    members is >= threshold; otherwise it gets a fresh id. Returns (new_id -> stable_id, stable_id -> reused_label)."""
    prev_members = {}
    for p in prev_points:
        if p["clusterId"] != -1:
            prev_members.setdefault(p["clusterId"], set()).add(p["xId"])
    prev_label = {c["id"]: c["label"] for c in prev_clusters}
    new_members = {}
    for i, l in enumerate(new_labels):
        if l != -1:
            new_members.setdefault(int(l), set()).add(ids[i])
    mapping, reused, taken = {-1: -1}, {}, set()
    next_id = (max(prev_label) + 1) if prev_label else 0
    for nl, mem in sorted(new_members.items(), key=lambda kv: -len(kv[1])):
        best, bj = None, 0.0
        for pid, pm in prev_members.items():
            if pid in taken:
                continue
            j = len(mem & pm) / len(mem | pm)
            if j > bj:
                best, bj = pid, j
        if best is not None and bj >= threshold:
            mapping[nl] = best
            reused[best] = prev_label.get(best, "")
            taken.add(best)
        else:
            mapping[nl] = next_id
            next_id += 1
    return mapping, reused


def cluster_centroids(xy, labels):
    return {int(k): (float(xy[labels == k, 0].mean()), float(xy[labels == k, 1].mean())) for k in set(labels.tolist()) if k != -1}
