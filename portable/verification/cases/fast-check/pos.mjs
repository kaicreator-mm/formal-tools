import fc from "fast-check";

fc.assert(fc.property(fc.integer(), (n) => n * 0 === 0), { numRuns: 200 });
console.log("NODEVERIFY: OK PASS");
