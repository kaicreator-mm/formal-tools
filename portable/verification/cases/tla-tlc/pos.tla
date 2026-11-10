---- MODULE pos ----
EXTENDS Integers
VARIABLES
  \* @type: Int;
  x
Init == x = 0
Next == IF x < 5 THEN x' = x + 1 ELSE UNCHANGED x
Inv == x >= 0
Spec == Init /\ [][Next]_x
====
