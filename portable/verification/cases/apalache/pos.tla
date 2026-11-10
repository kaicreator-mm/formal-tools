---- MODULE pos ----
EXTENDS Integers
VARIABLES
  \* @type: Int;
  x
Init == x = 0
Next == x' = x + 1
Inv == x >= 0
====
