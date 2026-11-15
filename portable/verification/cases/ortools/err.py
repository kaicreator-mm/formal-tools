from ortools.sat.python import cp_model

# A reversed integer domain must be rejected by CP-SAT as MODEL_INVALID.
m = cp_model.CpModel()
m.new_int_var(3, 2, "invalid_domain")
solver = cp_model.CpSolver()
status = solver.solve(m)
assert status == cp_model.MODEL_INVALID, status

# A malformed constraint must fail at the Python API boundary.
m2 = cp_model.CpModel()
try:
    m2.add("not a constraint")
except TypeError:
    print("PYVERIFY: OK MODEL_INVALID_AND_TYPE_REJECTED")
else:
    raise SystemExit("PYVERIFY: FAIL INVALID_CONSTRAINT_ACCEPTED")
