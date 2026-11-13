# R9 — real ELK semantic-negative closure

**OUTPUT_LABEL=FORMAL_TOOLS_I24_TOOL_INTEGRATION_CONTINUE** · [Source PR #22](https://github.com/kaicreator-mm/formal-tools/pull/22) Exact HEAD `8aa994718895bcf49988981b41d391f624075602` · ELK 0.6.0 (Issue #35).

The previous ELK neg fixture was a *malformed ontology parser rejection*, duplicating an error boundary instead of demonstrating an inference refutation. R9 changes **only one** trusted fixture file in the existing PR #22 Writer lane. The revised `EXPECT_NEG_VIA=sh` invokes a **fixed committed** ELK command; callers cannot supply shell text or raw argv through the shared MCP tool (the MCP gateway still allows only registry-checked id and timeout). No changes to shared Registry/Runner/SDK/MCP source.

The original `tests/elk/neg.ofn` is syntactically valid and semantically inconsistent: `DisjointClasses(A B)` together with an individual asserted to be in their intersection. A real Java 21 / ELK 0.6.0 classification produced:

```text
EquivalentClasses(<http://www.w3.org/2002/07/owl#Nothing> <http://www.w3.org/2002/07/owl#Thing> <http://example.org/neg#A> <http://example.org/neg#B>)
```

The bounded Runner asserts the **actual nonempty taxonomy file**, the exact `owl:Nothing` + `owl:Thing` equivalence, successful ELK re-classification of the generated file, and equality of the two taxonomy files. It does not match a Runner-generated `PHASE_DONE` marker or merely interpret exit0 as a proof.

| Phase | Real result | Observed |
| --- | --- | --- |
| POS valid entailment | exit 0, `CLASSIFIED_TAXONOMY` | `Parent` is a subclass of `Person`; taxonomy generated/reparsed and SHA-identical |
| NEG inconsistent ontology | exit 0, `INCONSISTENT_ONTOLOGY` | Valid input entails `owl:Thing ≡ owl:Nothing`, taxonomy generated/reparsed and SHA-identical |
| ERR missing input | exit 1, `MISSING_SOURCE` | FileNotFoundException |

**Actual host:** Debian13 x86_64; tool bundle root-owned and write-denied to UID1000; Java Temurin21.0.13+9; exact PR22 corrected Runner Git Blob `94909a645eee266549a6b17e42e5f4478d72aaee` and SHA256 `066674ca41414d1e80019218a5d20f404c0fef75785fb348fed313634720c1d3`. Current fixture Git Blob `82bb3272d0d21b73757f5f0d6d8bf6b5d6ce150f` byte-identical to the real executed fixture.

**[Authentic R9 raw native logs/ontologies/fixtures and manifest](https://drive.google.com/file/d/1atTwVLT9zl40qslsjTtHqaQHLK43Mxr3/view?usp=drivesdk)** are in canonical Drive `App/10-formal-tools/validation/receipts`; 8,966 B; SHA256 `3676e5bc5ac6853f7e4e84c94a0381c0b9d8b784bddd8b30e5fff6b381db8b0f`, verified after Drive readback, ZIP CRC PASS, 13 entries. [Machine-readable evidence index](./ELK_SEMANTIC_NEGATIVE.json). Runner TSV SHA256 `2c82fe0a06fa3bfb57b99a9d37786272516d573a3f6c675c19edcdfcc35b4869`. Positive taxonomy SHA256 `1a4b1a41…`; inconsistent negative taxonomy SHA256 `d5bf71cf…`.

**Gate boundary:** this is ELK source-level *technical* evidence only, not a new independent Native T4 PASS, not an external semantic Oracle sign-off, not full original CLI/MCP/SDK Host runtime, and not Product #11/T5. Independent Source-First review at R9 exact HEAD and exact-head CI are required before any formal admission. R8 five-tool receipts remain honest at their historical HEAD `7fbe3b…`; R9 changes only ELK `expect.sh` and does not require re-running unchanged AFL++/fast-check/Hypothesis/Mesa Native. #7/#14 not reopened.
