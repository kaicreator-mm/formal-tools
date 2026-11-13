---- MODULE neg ----
EXTENDS Integers
VARIABLES
  \* @type: Int;
  x
Init == x = 0
Next == IF x < 5 THEN x' = x + 1 ELSE UNCHANGED x
BadInv == x > 0
Spec == Init /\ [][Next]_x
====
