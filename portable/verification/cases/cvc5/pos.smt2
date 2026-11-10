(declare-const x Int)
(assert (= (* x x) 4))
(assert (> x 0))
(check-sat)
