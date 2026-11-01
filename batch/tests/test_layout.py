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
    second = run_layout(ids, X, prev, seed=2)
    assert second["residual"] is not None and second["residual"] < 0.10

def test_build_init_places_new_points_near_their_neighbours(blobs):
    ids, X, lab = blobs; xy = fit_display(X, None, seed=1)
    new_ids = ids + ["999"]; Xn = np.vstack([X, X[0:1]])
    init = build_init(new_ids, ids, xy, Xn)
    assert np.linalg.norm(init[-1] - xy[0]) < 0.5

def test_cluster_space_dims(blobs):
    ids, X, _ = blobs; assert fit_cluster_space(X, seed=1).shape == (len(X), 10)
