import fc from "fast-check";
// Explicit API-boundary failure: fc.assert requires a property instance.
fc.assert(null);
