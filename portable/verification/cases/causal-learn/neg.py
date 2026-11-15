import math
import numpy as np
from causallearn.search.ConstraintBased.PC import pc

# Independent seeded Gaussian streams give an actual linear-Gaussian
# independence case; verify the Fisher-Z test is on the non-rejection side
# before asking PC to recover the empty two-node graph.
n = 1024
x = np.random.default_rng(19).normal(size=n)
y = np.random.default_rng(23).normal(size=n)
data = np.column_stack([x, y])

corr = float(np.corrcoef(data, rowvar=False)[0, 1])
fisher_z = math.atanh(corr) * math.sqrt(n - 3)
p_value = math.erfc(abs(fisher_z) / math.sqrt(2.0))
assert p_value > 0.05, f"independence fixture unexpectedly rejects Fisher-Z: p={p_value:.8f}"

g = pc(data, alpha=0.05, indep_test="fisherz", show_progress=False,
       node_names=["X", "Y"]).G
assert g.graph[0, 1] == 0 and g.graph[1, 0] == 0, "independent X/Y must have no edge"
print("PYVERIFY: OK INDEPENDENT_GAUSSIAN_NO_EDGE")
