import mesa

try:
    mesa.Agent(None)  # an agent requires a model
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except AttributeError as exc:
    # Classify only the exact missing-model registration failure. Do not turn
    # unrelated AttributeError/API regressions into a successful refutation.
    if str(exc) != "'NoneType' object has no attribute 'register_agent'":
        raise
    print("PYVERIFY: OK REFUTED AttributeError NoneType.register_agent")
