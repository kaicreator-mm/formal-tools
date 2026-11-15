import numpy as np
from causallearn.search.ConstraintBased.PC import pc

# Construct centered orthogonal columns so the sample correlation is zero;
# this is a valid independent-data negative case, not malformed-input handling.
n = 512
rng = np.random.default_rng(19)
raw = rng.normal(size=(n, 2))
raw -= raw.mean(axis=0)
q, _ = np.linalg.qr(raw)
data = q[:, :2] * np.sqrt(n)

g = pc(data, alpha=0.05, indep_test="fisherz", show_progress=False,
       node_names=["X", "Y"]).G
assert g.graph[0, 1] == 0 and g.graph[1, 0] == 0, "independent X/Y must have no edge"
print("PYVERIFY: OK INDEPENDENT_NO_EDGE")
