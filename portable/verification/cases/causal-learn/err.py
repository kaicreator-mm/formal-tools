import numpy as np
from causallearn.search.ConstraintBased.PC import pc

try:
    pc(np.array([[1.0, 2.0], [3.0]]), alpha=0.05, indep_test="fisherz")
except (ValueError, TypeError) as exc:
    print("PYVERIFY: OK INVALID_INPUT_REJECTED", type(exc).__name__)
else:
    print("PYVERIFY: FAIL INVALID_INPUT_ACCEPTED")
    raise SystemExit(3)
