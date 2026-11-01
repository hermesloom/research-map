import warnings
import numpy as np
import umap
from scipy.linalg import orthogonal_procrustes
from scipy.spatial import procrustes as scipy_procrustes
from sklearn.neighbors import NearestNeighbors

warnings.filterwarnings("ignore")


def _norm(E):
    return E / np.linalg.norm(E, axis=1, keepdims=True)


def fit_display(E, init, seed=42):
    """2-D display layout. `init` = previous coordinates for a warm start, else spectral init."""
    red = umap.UMAP(n_neighbors=15, min_dist=0.05, n_components=2, metric="cosine", random_state=seed, init="spectral" if init is None else init)
    return red.fit_transform(_norm(E)).astype(np.float64)


def fit_cluster_space(E, seed=42):
    """Separate 10-D space for clustering (the 2-D map alone yields ~3 clusters on this corpus)."""
    return umap.UMAP(n_neighbors=15, min_dist=0.0, n_components=10, metric="cosine", random_state=seed).fit_transform(_norm(E))


def build_init(ids, prev_ids, prev_xy, E):
    """Warm-start positions: previous coords for shared ids; nearest shared neighbour (+ small jitter) for new ids."""
    pos = {pid: i for i, pid in enumerate(prev_ids)}
    En = _norm(E)
    shared = [i for i, x in enumerate(ids) if x in pos]
    new = [i for i, x in enumerate(ids) if x not in pos]
    init = np.zeros((len(ids), 2))
    for i in shared:
        init[i] = prev_xy[pos[ids[i]]]
    if new and shared:
        nn = NearestNeighbors(n_neighbors=1, metric="cosine").fit(En[shared])
        _, j = nn.kneighbors(En[new])
        rng = np.random.default_rng(0)
        scale = 0.05 * (prev_xy.max(0) - prev_xy.min(0)).mean()
        for k, i in enumerate(new):
            init[i] = init[shared[j[k, 0]]] + rng.normal(scale=scale, size=2)
    return init


def align(xy, prev_xy, shared_new, shared_prev):
    """Similarity transform (scale, rotation/reflection, translation) fitted on shared ids, applied to all rows.
    Returns (aligned_xy, disparity) with disparity = scipy procrustes disparity on the shared subset (0 = identical, 1 = unrelated)."""
    A = xy[shared_new]
    B = prev_xy[shared_prev]
    ma, mb = A.mean(0), B.mean(0)
    A0, B0 = A - ma, B - mb
    sa = np.linalg.norm(A0)
    sb = np.linalg.norm(B0)
    R, _ = orthogonal_procrustes(A0 / sa, B0 / sb)
    s = sb / sa
    aligned = ((xy - ma) @ R) * s + mb
    _, _, disp = scipy_procrustes(B, aligned[shared_new])
    return aligned, float(disp)


def run_layout(ids, E, prev, seed=42):
    """Full layout step. `prev` = {"ids": [...], "xy": [[x,y],...]} of the previous published layout, or None."""
    init = None
    residual = None
    if prev is not None and len(prev["ids"]):
        init = build_init(ids, prev["ids"], np.asarray(prev["xy"], dtype=float), E)
    xy = fit_display(E, init, seed=seed)
    if prev is not None and len(prev["ids"]):
        pos = {pid: i for i, pid in enumerate(prev["ids"])}
        shared_new = np.array([i for i, x in enumerate(ids) if x in pos])
        shared_prev = np.array([pos[ids[i]] for i in shared_new])
        if len(shared_new) >= 3:
            xy, residual = align(xy, np.asarray(prev["xy"], dtype=float), shared_new, shared_prev)
    return {"xy": xy, "residual": residual, "x10": fit_cluster_space(E, seed=seed)}
