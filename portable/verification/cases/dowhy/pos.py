import numpy as np
import pandas as pd
from dowhy import CausalModel

rng = np.random.default_rng(42)
n = 3000
t = rng.normal(0.0, 1.0, n)
out = 2.0 * t + rng.normal(0.0, 1.0, n)
df = pd.DataFrame({"t": t, "out": out})

model = CausalModel(data=df, treatment="t", outcome="out",
                    graph="digraph { t -> out; }")
identified = model.identify_effect(proceed_when_unidentifiable=False)
est = model.estimate_effect(identified, method_name="backdoor.linear_regression")
val = float(est.value)
assert abs(val - 2.0) < 0.3, val
print("PYVERIFY: OK ATE=%.3f" % val)
