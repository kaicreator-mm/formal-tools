from hypothesis import given, strategies as st


def always_odd_property(n):
    assert n % 2 == 1  # false for even n -> Hypothesis must find a counterexample


always_odd = given(st.integers())(always_odd_property)
try:
    always_odd()
    print("PYVERIFY: FAIL no counterexample")
    raise SystemExit(3)
except AssertionError:
    # Hypothesis reports this property failure as AssertionError. Require the
    # traceback to include this exact property body; do not swallow API/runtime
    # AssertionErrors raised elsewhere in the runner or library.
    import sys

    tb = sys.exc_info()[2]
    while tb is not None and tb.tb_frame.f_code is not always_odd_property.__code__:
        tb = tb.tb_next
    if tb is None:
        raise
    print("PYVERIFY: OK COUNTEREXAMPLE")
