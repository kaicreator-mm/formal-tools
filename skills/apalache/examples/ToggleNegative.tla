---- MODULE ToggleNegative ----
EXTENDS Integers
VARIABLE
    \* @type: Int;
    x
Init == x = 0
Next == x' = 1 - x
Inv == x = 0
====
