// Negative: assertion is violated -> VERIFICATION FAILURE (cbmc exits 10)
int main(void) {
  int x = 1;
  assert(x == 2);
  return 0;
}
