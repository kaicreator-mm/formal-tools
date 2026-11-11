# Portable Runtime Build Summary (Debian 13 x86_64)

Original receipts generated: 2026-11-11T15:00:31+00:00; original source HEAD: `unrecorded`.
Platform: Debian 13 x86_64 / Python 3.13.5 / Node.js 22.16.0 / Java 21.

**Qualification override (Issue #11, 2026-11-12): previous native PASS receipts are STALE until replay.** The earlier runner saved the result of a succeeding directory change, not the real tool/timeout exit code. Match-on-output alone cannot certify those results. The repaired runner tags receipts with `formal-tools/portable-verify/0.2`, captures the true exit code, fails on missing contracts or failed setup, and resets the per-run TSV. The source-built packages remain available as build assets; no new native execution is claimed.

| Metric | Current |
|---|---:|
| Registered tools | 36 |
| PACKAGED build assets | 34 |
| Fresh runtime-verified PASS | 0 |
| Legacy self-reported PASS (now stale) | 34 |
| UNAVAILABLE | 2 |

| Tool | Build availability | Version | Current evidence | Blocker |
|---|---|---|---|---|
| aflpp | PACKAGED | 5.03c | STALE_REVERIFY_REQUIRED | - |
| alloy | PACKAGED | 6.2.0 | STALE_REVERIFY_REQUIRED | - |
| apache-jena | PACKAGED | 5.5.0 | STALE_REVERIFY_REQUIRED | - |
| apalache | PACKAGED | 0.63.0 | STALE_REVERIFY_REQUIRED | - |
| causal-learn | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| cbmc | PACKAGED | 6.11.0 | STALE_REVERIFY_REQUIRED | - |
| clingo | PACKAGED | 5.8.3 | STALE_REVERIFY_REQUIRED | - |
| cvc5 | PACKAGED | 1.4.2 | STALE_REVERIFY_REQUIRED | - |
| dafny | PACKAGED | 4.11.0 | STALE_REVERIFY_REQUIRED | - |
| dowhy | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| elk | PACKAGED | 0.6.0 | STALE_REVERIFY_REQUIRED | - |
| fast-check | PACKAGED | 4.3.0 | STALE_REVERIFY_REQUIRED | - |
| fast-downward | PACKAGED | 24.06 | STALE_REVERIFY_REQUIRED | - |
| highs | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| hypothesis | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| kani | PACKAGED | 0.68.0 | STALE_REVERIFY_REQUIRED | - |
| lean4 | PACKAGED | 4.35.0 | STALE_REVERIFY_REQUIRED | - |
| mesa | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| minizinc | PACKAGED | 2.10.1 | STALE_REVERIFY_REQUIRED | - |
| networkx | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| nuxmv | UNAVAILABLE | 2.1.0 | SKIP | nuXmv binaries require manual license acceptance on nuxmv.fbk.eu (form-gated); no automatable official channel — candidates tried all failed |
| ortools | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| prism | PACKAGED | 4.11 | STALE_REVERIFY_REQUIRED | - |
| prob | UNAVAILABLE | 1.16.1 | SKIP | probcli zips (1.16.1/1.15.1/nightly) lack probcliparser.jar — no public release channel for the parser artifact (maven/github probed); manual upstream support needed |
| pymc | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| rdf-shacl | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| robot | PACKAGED | 1.9.11 | STALE_REVERIFY_REQUIRED | - |
| simpy | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| souffle | PACKAGED | 2.5 | STALE_REVERIFY_REQUIRED | - |
| storm | PACKAGED | 2.0.0 | STALE_REVERIFY_REQUIRED | - |
| sympy | PACKAGED | unknown | STALE_REVERIFY_REQUIRED | - |
| tla-tlc | PACKAGED | 1.8.0 | STALE_REVERIFY_REQUIRED | - |
| tree-sitter | PACKAGED | 0.27.2 | STALE_REVERIFY_REQUIRED | - |
| vampire | PACKAGED | 5.1.0 | STALE_REVERIFY_REQUIRED | - |
| why3 | PACKAGED | 1.8.0 | STALE_REVERIFY_REQUIRED | - |
| z3 | PACKAGED | 5.4.0 | STALE_REVERIFY_REQUIRED | - |

Previous raw `receipts/verify-*.json` remain historical artifacts, not verified execution after the exit-code correction. To requalify, run `tool-runner verify all` in the exact offline Debian 13 bundle with corrected runner, regenerate machine-readable receipts with `portable/verification/build-receipts.py`, record the bundle SHA256 and immutable tool identities, and independently source-review new Exact-SHA evidence. Portable tool execution never by itself qualifies G3 business Claims, G4 reusable Solutions, G5 A/B, or G6 DIS consumption.
