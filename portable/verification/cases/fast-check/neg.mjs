import fc from "fast-check";

try {
  fc.assert(fc.property(fc.integer(), (n) => n * n < 0), { numRuns: 200 });
  console.log("NODEVERIFY: FAIL no counterexample found");
  process.exit(3);
} catch (error) {
  // Only fast-check's property-failure Error is the expected counterexample.
  // Invalid-property/API errors and unrelated runtime failures must propagate.
  if (
    !(error instanceof Error) ||
    error.name !== "Error" ||
    !/^Property failed after \d+ tests?\n/.test(error.message) ||
    !/Counterexample: \[0\]/.test(error.message)
  ) {
    throw error;
  }
  console.log("NODEVERIFY: OK COUNTEREXAMPLE");
}
