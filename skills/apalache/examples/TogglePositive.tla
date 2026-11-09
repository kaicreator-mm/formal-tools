---- MODULE TogglePositive ----
VARIABLE x
Init == x = 0
Next == x' = 1 - x
Inv == x \in {0, 1}
====
