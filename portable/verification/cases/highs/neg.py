import highspy

h = highspy.Highs()
h.setOptionValue("output_flag", False)
inf = highspy.kHighsInf
h.addVar(2.0, 3.0)
h.addVar(2.0, 3.0)
h.addRow(-inf, 1.0, 2, [0, 1], [1.0, 1.0])  # x + y <= 1 with x,y >= 2 -> infeasible
h.run()
status = h.getModelStatus()
assert status == highspy.HighsModelStatus.kInfeasible, status
print("PYVERIFY: OK INFEASIBLE")
