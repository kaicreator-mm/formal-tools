// Positive: property holds for all inputs -> VERIFICATION SUCCESSFUL
int __VERIFIER_nondet_int(void);
int main(void) {
  int x = __VERIFIER_nondet_int();
  if (x < 0) return -1;
  assert(x >= 0);
  return 0;
}
