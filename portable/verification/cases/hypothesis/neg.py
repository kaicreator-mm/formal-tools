from hypothesis import given, strategies as st


@given(st.integers())
def always_odd(n):
    assert n % 2 == 1  # false for even n -> hypothesis must find a counterexample


try:
    always_odd()
    print("PYVERIFY: FAIL no counterexample")
    raise SystemExit(3)
except Exception:
    # counterexample found (hypothesis raises its own falsified error type)
    print("PYVERIFY: OK COUNTEREXAMPLE")
