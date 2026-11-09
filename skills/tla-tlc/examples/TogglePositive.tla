---- MODULE TogglePositive ----
EXTENDS Integers
VARIABLE x
Init == x = 0
Next == x' = 1 - x
Inv == x \in {0, 1}
Spec == Init /\ [][Next]_x
====
