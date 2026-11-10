import pymc as pm
import numpy as np

try:
    with pm.Model():
        p = pm.Beta("p", alpha=1, beta=1)
        pm.Binomial("obs", n=-1, p=p, observed=np.array([1]))  # invalid n
        pm.sample(draws=10, chains=1, progressbar=False, compute_convergence_checks=False)
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except Exception as exc:
    print("PYVERIFY: OK REFUTED %s" % type(exc).__name__)
