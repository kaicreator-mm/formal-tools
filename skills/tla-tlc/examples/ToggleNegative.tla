---- MODULE ToggleNegative ----
EXTENDS Integers
VARIABLE x
Init == x = 0
Next == x' = 1 - x
Inv == x = 0
Spec == Init /\ [][Next]_x
====
