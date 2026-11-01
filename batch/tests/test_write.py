import numpy as np
from research_map_batch.write import assemble_layout

def test_gate_drafts_when_residual_high():
    ids = ["1", "2", "3"]; xy = np.array([[0, 0], [1, 1], [2, 2]], float); lab = np.array([0, 0, -1])
    clusters = {0: {"id": 0, "label": "A", "description": "", "size": 2, "themeId": 0}}; themes = [{"id": 0, "label": "T", "description": "", "clusterIds": [0]}]
    ok = assemble_layout(ids, xy, lab, clusters, themes, [], residual=0.03, prev_version=1)
    bad = assemble_layout(ids, xy, lab, clusters, themes, [], residual=0.25, prev_version=1)
    assert ok["status"] == "published" and ok["version"] == 2 and bad["status"] == "draft"
    assert [p["provisional"] for p in ok["points"]] == [False, False, False]
    assert {l["level"] for l in ok["labels"]} == {0, 1} and ok["clusters"][0]["x"] == 0.5

def test_first_layout_publishes_without_residual():
    l = assemble_layout(["1"], np.zeros((1, 2)), np.array([-1]), {}, [], [], residual=None, prev_version=0); assert l["status"] == "published" and l["version"] == 1
