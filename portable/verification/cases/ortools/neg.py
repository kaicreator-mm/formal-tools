from ortools.sat.python import cp_model

m = cp_model.CpModel()
x = m.new_int_var(2, 3, "x")
y = m.new_int_var(2, 3, "y")
m.add(x + y <= 1)  # infeasible: x,y >= 2
s = cp_model.CpSolver()
status = s.solve(m)
assert status == cp_model.INFEASIBLE, status
print("PYVERIFY: OK INFEASIBLE")
