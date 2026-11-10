import fc from "fast-check";

try {
  fc.assert(fc.property(fc.integer(), (n) => n * n < 0), { numRuns: 200 });
  console.log("NODEVERIFY: FAIL no counterexample found");
  process.exit(3);
} catch (e) {
  console.log("NODEVERIFY: OK COUNTEREXAMPLE");
}
