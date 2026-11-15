import numpy as np
from causallearn.search.ConstraintBased.PC import pc

pc_invoked = False


def invoke_pc(data):
    global pc_invoked
    pc_invoked = True
    return pc(data, alpha=0.05, indep_test="fisherz")


try:
    invoke_pc(np.empty((0, 2), dtype=np.float64))
except ValueError as exc:
    assert pc_invoked, "causal-learn PC entry point must be invoked"
    print("PYVERIFY: OK INVALID_INPUT_REJECTED", type(exc).__name__)
else:
    print("PYVERIFY: FAIL INVALID_INPUT_ACCEPTED")
    raise SystemExit(3)
