// Negative: assertion holds, check finds no counterexample -> ALLOY_RESULT: UNSATISFIABLE
sig Node {}
assert reflexive { all n: Node | n = n }
check reflexive for 3 Node
