from hypothesis import given, strategies as st
from hypothesis.errors import Falsified


@given(st.integers())
def always_odd(n):
    assert n % 2 == 1  # false for even n -> hypothesis must find a counterexample


try:
    always_odd()
    print("PYVERIFY: FAIL no counterexample")
    raise SystemExit(3)
except (Falsified, AssertionError):
    print("PYVERIFY: OK COUNTEREXAMPLE")
