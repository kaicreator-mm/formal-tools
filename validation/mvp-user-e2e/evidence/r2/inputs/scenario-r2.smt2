(set-logic QF_LIA)
; R2 E2E three-entry parity fixture (i180/r2-e2e @ 7b85e82e434152e139d0d93bfb76ef72ad076f21).
; Hand-certain UNSAT: x,y in [0,3] force x+y <= 6, so x+y >= 9 is unsatisfiable
; over any interpretation. Distinct from the V6 scenario-a fixture on purpose.
(declare-fun x () Int)
(declare-fun y () Int)
(assert (>= x 0))
(assert (<= x 3))
(assert (>= y 0))
(assert (<= y 3))
(assert (>= (+ x y) 9))
(check-sat)
(exit)
