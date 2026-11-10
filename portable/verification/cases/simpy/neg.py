import simpy

try:
    env = simpy.Environment()
    env.timeout(-1)  # negative delay must be rejected
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except ValueError:
    print("PYVERIFY: OK REFUTED")
