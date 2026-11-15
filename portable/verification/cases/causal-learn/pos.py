import numpy as np
from causallearn.search.ConstraintBased.PC import pc

rng = np.random.default_rng(7)
n = 800
x = rng.normal(size=n)
y = 1.2 * x + rng.normal(0.0, 0.3, size=n)
z = 1.5 * y + rng.normal(0.0, 0.3, size=n)
data = np.column_stack([x, y, z])

corr_xz = float(np.corrcoef(data, rowvar=False)[0, 2])
assert abs(corr_xz) > 0.2, "X-Z must be marginally dependent in the chain X-Y-Z"

g = pc(data, alpha=0.05, indep_test="fisherz", show_progress=False,
       node_names=["X", "Y", "Z"]).G


def adjacent(i, j):
    return g.graph[i, j] != 0 or g.graph[j, i] != 0


assert not adjacent(0, 2), "X-Z must be conditionally independent given Y"
assert adjacent(0, 1) and adjacent(1, 2), "chain edges must be detected"
print("PYVERIFY: OK PC_CHAIN")
