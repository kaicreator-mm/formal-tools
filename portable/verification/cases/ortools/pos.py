from ortools.sat.python import cp_model

m = cp_model.CpModel()
x = m.new_int_var(0, 3, "x")
y = m.new_int_var(0, 3, "y")
m.add(x + y <= 4)
m.maximize(2 * x + 3 * y)
s = cp_model.CpSolver()
status = s.solve(m)
assert status == cp_model.OPTIMAL, status
obj = s.value(2 * x + 3 * y)
assert obj == 11, obj  # x=1, y=3
print("PYVERIFY: OK OPTIMAL obj=%d" % obj)
