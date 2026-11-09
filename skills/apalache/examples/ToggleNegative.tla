---- MODULE ToggleNegative ----
VARIABLE x
Init == x = 0
Next == x' = 1 - x
Inv == x = 0
====
