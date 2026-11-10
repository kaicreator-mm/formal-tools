import highspy

h = highspy.Highs()
h.setOptionValue("output_flag", False)
inf = highspy.kHighsInf
# maximize x + y subject to x + 2y <= 4, x >= 0, 0 <= y <= 2  -> optimum 4
h.addVar(0.0, inf)
h.addVar(0.0, 2.0)
h.changeColCost(0, 1.0)
h.changeColCost(1, 1.0)
h.addRow(-inf, 4.0, 2, [0, 1], [1.0, 2.0])
h.changeObjectiveSense(highspy.ObjSense.kMaximize)
h.run()
status = h.getModelStatus()
assert status == highspy.HighsModelStatus.kOptimal, status
obj = h.getInfo().objective_function_value
assert abs(obj - 4.0) < 1e-6, obj
print("PYVERIFY: OK OPTIMAL obj=%.3f" % obj)
