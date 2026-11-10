import mesa

try:
    mesa.Agent(None)  # an agent requires a model
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except Exception as exc:
    print("PYVERIFY: OK REFUTED %s" % type(exc).__name__)
