import numpy as np, pytest
@pytest.fixture(scope="session")
def blobs():
    rng = np.random.default_rng(0)
    centers = rng.normal(size=(3, 64)); X = np.vstack([c + 0.15 * rng.normal(size=(60, 64)) for c in centers])
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    ids = [str(10_000 + i) for i in range(len(X))]; labels = np.repeat([0, 1, 2], 60)
    return ids, X, labels
