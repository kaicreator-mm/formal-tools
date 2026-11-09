MACHINE Positive
VARIABLES n
INVARIANT n : NAT & n <= 2
INITIALISATION n := 0
OPERATIONS
  inc = PRE n < 2 THEN n := n + 1 END;
  pause = BEGIN skip END
END
