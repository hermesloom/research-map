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

def test_next_version_counts_drafts_too():
    from research_map_batch.write import next_version
    class FakeLayouts:
        def find_one(self, *_a, **k): return {"version": 3}  # highest of ANY status
    class FakeDB: layouts = FakeLayouts()
    assert next_version(FakeDB()) == 4

def test_force_publish_keeps_the_measured_residual():
    ids = ["1"]; xy = np.zeros((1, 2)); lab = np.array([-1])
    l = assemble_layout(ids, xy, lab, {}, [], [], residual=0.25, prev_version=1, force_publish=True)
    assert l["status"] == "published" and l["procrustesResidual"] == 0.25 and l["forced"] is True

def test_promote_marks_draft_published_and_advances_items():
    from research_map_batch.write import promote
    calls = []
    class Layouts:
        def find_one(self, q, **k): return {"version": 5, "status": "draft", "points": [{"xId": "a"}]} if q.get("version") == 5 else None
        def update_one(self, q, u): calls.append(("layouts", q, u))
    class Items:
        def update_many(self, q, u): calls.append(("items", q, u))
    class DB: layouts = Layouts(); items = Items()
    assert promote(DB(), 5) is True
    assert any(c[0] == "layouts" and c[2]["$set"]["status"] == "published" for c in calls)
    assert any(c[0] == "items" and c[2]["$set"]["stage"] == "placed" for c in calls)
