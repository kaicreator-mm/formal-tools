// Positive: satisfiable predicate -> ALLOY_RESULT: SATISFIABLE
sig Node {}
pred hasThree { some Node }
run hasThree for exactly 3 Node
