import sympy

x = sympy.Symbol("x")
roots = sympy.solve(x**2 - 4, x)
assert sorted(int(r) for r in roots) == [-2, 2], roots
assert sympy.integrate(2 * x, x) == x**2
assert sympy.simplify(sympy.sin(x) ** 2 + sympy.cos(x) ** 2) == 1
print("PYVERIFY: OK SOLVED")
