method Bad(a: int) returns (s: int)
  ensures s == a + 1
{
  s := a + 2;  // violates postcondition
}
