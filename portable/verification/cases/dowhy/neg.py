import numpy as np
import pandas as pd
from dowhy import CausalModel

df = pd.DataFrame({"t": [1.0, 2.0], "out": [1.0, 2.0]})
try:
    model = CausalModel(data=df, treatment="not_a_column", outcome="out",
                        graph="digraph { t -> out; }")
    model.identify_effect()
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except Exception as exc:
    print("PYVERIFY: OK REFUTED %s" % type(exc).__name__)
