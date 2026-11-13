import numpy as np
import pymc as pm

with pm.Model():
    p = pm.Beta("p", alpha=1, beta=1)
    pm.Binomial("obs", n=10, p=p, observed=np.array([8]))
    trace = pm.sample(draws=200, tune=200, chains=1, progressbar=False,
                      compute_convergence_checks=False, random_seed=42)
mean = float(trace.posterior["p"].mean())
assert 0.4 < mean < 0.95, mean
print("PYVERIFY: OK POSTERIOR_MEAN=%.3f" % mean)
