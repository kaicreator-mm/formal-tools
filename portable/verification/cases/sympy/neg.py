import sympy

try:
    m = sympy.Matrix([[1, 2], [3]])  # ragged matrix must be rejected
    m.det()
    print("PYVERIFY: FAIL expected exception")
    raise SystemExit(3)
except ValueError:
    print("PYVERIFY: OK REFUTED")
