import numpy as np, json
from research_map_batch.label import pick_examples, name_cluster, build_themes, label_all, ClusterName, ThemeName

class FakeLLM:
    def __init__(self): self.calls = []
    def __call__(self, prompt, model):
        self.calls.append(prompt)
        if model is ClusterName: return ClusterName(label="Fake Cluster", description="d")
        import re; n = len(re.findall(r"^Group \d+:", prompt, flags=re.M))
        from research_map_batch.label import ThemeNames; return ThemeNames(labels=[f"Fake Theme {i + 1}" for i in range(max(n, 1))])

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

def test_build_themes_names_all_groups_in_one_contrastive_call():
    from research_map_batch.label import ThemeNames
    class OneCall:
        def __init__(self): self.calls = []
        def __call__(self, prompt, model):
            self.calls.append((prompt, model)); assert model is ThemeNames
            import re; n = len(re.findall(r"^Group \d+:", prompt, flags=re.M)); return ThemeNames(labels=[f"Theme {i}" for i in range(n)])
    labels = {i: f"Label {i}" for i in range(12)}; vecs = np.random.default_rng(1).normal(size=(12, 8))
    llm = OneCall(); themes = build_themes(labels, vecs, llm)
    assert len(llm.calls) == 1                                           # one call names every theme, so names can be made distinct
    prompt = llm.calls[0][0]
    assert "Group 1:" in prompt and "distinct" in prompt.lower() and "do not reuse" in prompt.lower()
    assert sorted(t["label"] for t in themes) == sorted(f"Theme {i}" for i in range(len(themes)))

def test_cluster_prompt_forbids_question_boilerplate():
    llm = FakeLLM(); name_cluster(["a"], ["b"], llm)
    assert "do not reuse" in llm.calls[0].lower() and "interoperable" in llm.calls[0].lower()
