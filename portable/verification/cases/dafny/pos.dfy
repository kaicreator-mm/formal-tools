method Add(a: int, b: int) returns (s: int)
  ensures s == a + b
{
  s := a + b;
  assert s == a + b;
}
