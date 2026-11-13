import numpy as np
from causallearn.search.ConstraintBased.PC import pc

try:
    pc(np.array([[1.0, 2.0], [3.0]]), alpha=0.05, indep_test="fisherz")  # ragged data
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except Exception as exc:
    print("PYVERIFY: OK REFUTED %s" % type(exc).__name__)
