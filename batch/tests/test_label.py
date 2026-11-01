import numpy as np, json
from research_map_batch.label import pick_examples, name_cluster, build_themes, label_all, ClusterName, ThemeName

class FakeLLM:
    def __init__(self): self.calls = []
    def __call__(self, prompt, model):
        self.calls.append(prompt)
        if model is ClusterName: return ClusterName(label="Fake Cluster", description="d")
        return ThemeName(label="Fake Theme", description="d")

def fake_embed(texts):
    rng = np.random.default_rng(len(texts)); return rng.normal(size=(len(texts), 8))

def test_pick_examples_prefers_centroid_and_nearest_outside(blobs):
    ids, X, lab = blobs; i_in = np.where(lab == 0)[0]; i_out = np.where(lab != 0)[0]
    a, b = pick_examples(X, i_in, i_out, n_in=5, n_out=3)
    assert len(a) == 5 and len(b) == 3 and set(a) <= set(i_in.tolist()) and set(b) <= set(i_out.tolist())

def test_name_cluster_prompt_contains_contrast():
    llm = FakeLLM(); r = name_cluster(["in one", "in two"], ["out one"], llm)
    assert r.label == "Fake Cluster"; assert "NOT in the cluster" in llm.calls[0] and "out one" in llm.calls[0]

def test_label_all_reuses_and_overrides(blobs, tmp_path, monkeypatch):
    ids, X, lab = blobs; llm = FakeLLM()
    texts = {i: f"summary {i}" for i in ids}
    ov = tmp_path / "label-overrides.json"; ov.write_text(json.dumps({"2": "Owner Label"})); monkeypatch.setenv("LABEL_OVERRIDES", str(ov))
    clusters, themes = label_all(ids, X, texts, lab, reused={0: "Kept Label"}, llm=llm, embed=fake_embed)
    assert clusters[0]["label"] == "Kept Label"; assert clusters[1]["label"] == "Fake Cluster"; assert clusters[2]["label"] == "Owner Label"
    assert sum(1 for c in llm.calls if "NOT in the cluster" in c) == 1
    assert len(themes) >= 1 and all("clusterIds" in t for t in themes)

def test_build_themes_k_bounds():
    labels = {i: f"L{i}" for i in range(40)}; vecs = np.random.default_rng(0).normal(size=(40, 8))
    themes = build_themes(labels, vecs, FakeLLM()); assert 5 <= len(themes) <= 9 and sorted(c for t in themes for c in t["clusterIds"]) == list(range(40))
