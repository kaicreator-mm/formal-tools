---- MODULE neg ----
EXTENDS Integers
VARIABLES x
Init == x = 0
Next == x' = x + 1
BadInv == x > 0
====
