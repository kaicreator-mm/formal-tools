; counterexample domain: x must be simultaneously positive and negative -> UNSAT
(declare-const x Int)
(assert (> x 0))
(assert (< x 0))
(check-sat)
