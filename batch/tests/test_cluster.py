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
