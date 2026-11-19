# Tool Operation Readiness — 36-tool matrix (I180/V1)

- OUTPUT_LABEL: `FORMAL_TOOLS_I180_V1_TOOL_READINESS`
- Issue: kaicreator-mm/formal-tools#181 (parent #180; portfolio #24; capability ledger from PR #179)
- Base: main @ `33bd3d0` (`feat(capabilities): rebind nuxmv/prob to native r181 image-refresh receipts (r181/A2) (#179)`)
- Date: 2026-11-19
- Scope: readiness classification only. This document grants no T3/T4/T5 acceptance and reuses — never re-runs — the #179 36-tool sweep.

## 0. The one distinction this document exists to protect

**Native fixture PASS is NOT a typed user operation.**

- `registry/CAPABILITY_VALIDATION.json` certifies that each tool's registered capability was demonstrated on the deployed bundle by fixed pos/neg/err fixture probes (`NATIVE_PROBE_PASS_SCOPED`). That is a *capability probe*, scoped to the exact bundle, explicitly "NOT formal T3 acceptance, T4 integration, T5 business qualification, T6 maintenance, Product or Release grant" (ledger `semantics.warning`).
- A **typed user operation** is a caller-controllable, schema-validated operation admitted by an execution gateway. In main @ `33bd3d0` exactly one such operation exists end to end: `highs` / `solve-lp` (`planPortfolioOperation` + `runPortfolioOperation` in `packages/runner/js/tool-portfolio-t4.mjs`, exposed via SDK, CLI `portfolio invoke highs solve-lp`, and MCP `run_portfolio_operation`).

## 1. Ledger byte-verification (no sweep re-run)

`registry/CAPABILITY_VALIDATION.json` (schema `formal-tools/capability-validation/0.1`) was re-checked byte-level on 2026-11-19:

| check | result |
|---|---|
| tools listed / unique ids | 36 / 36 |
| all `status` = `NATIVE_PROBE_PASS_SCOPED` | yes (36) |
| all `verify_verdict` = `PASS` | yes (36) |
| probe quality | 29 `EFFECTIVE`, 7 `INEFFECTIVE_OUTPUT` |
| `counts` block vs tool rows | consistent (`tools`, `native_probe_pass_scoped`, `probe_quality_effective`, `probe_quality_ineffective` all match) |
| required fields per row (`id,status,evidence_ref,evidence_sha256,verify_verdict,verify_phases,declared_version,probe_status,probe_quality,capability_ids,io`) | all present on all 36 rows |
| receipt files referenced by `evidence_ref` exist in-tree | 36 / 36 (r176 receipts; `nuxmv`,`prob` use r181 receipts) |
| runner pin cross-check | bundle `bin/tool-runner` sha256 `020f8f5e…2eceeb65a` == ledger `authority.r181_refresh.tool_runner_sha256` (verified live on host) |

Status enum in the ledger: `NATIVE_PROBE_PASS_SCOPED` (36), `PORTABLE_LANE_PASS_SCOPED` (0), `NOT_VERIFIED` (0).

## 2. Discovery lanes

1. **Native catalog lane** — `packages/runner/js/native-catalog.mjs`: 13 `native-ref` tools with curated typed operations (`planNative`) and trusted-local execution (`executeNativePlan` in `native.mjs`, modes `LOCAL_CLI_ONLY` / `LOCAL_CLI` / `typed`). These are *developer CLI adapters*, not admitted portfolio user operations; raw argv pass-through is `LOCAL_CLI_ONLY` and never MCP-exposed.
2. **Portfolio lane** — `packages/runner/js/tool-portfolio-t4.mjs`: all 36 tools (`NATIVE_CATALOG_13` for the 13 native-ref, `PORTABLE_FIXTURE_GATE_ONLY` for 22 candidates, `PORTABLE_TYPED_PYTHON_LIBRARY_CANDIDATE` for highs). Candidate tools get `doctor` and `verify-fixture` (fixed committed fixtures) and **no** raw argv; `planPortfolioOperation` rejects everything except `highs`/`solve-lp` ("unadmitted typed portfolio operation").

## 3. Status vocabulary

| label | meaning |
|---|---|
| `READY` | a real caller-controlled typed user operation is admitted and executable **today** |
| `READY-VIA-V3-PLAN` | not callable as a typed user operation today; the in-flight #183 workflow-executor will admit it (planned, not present in this base) |
| `FIXTURE_ONLY` | only the fixed committed pos/neg/err fixture gate exists; no caller-controlled typed operation is admitted (native lane tools may still have catalog typed ops for trusted-local CLI use — noted per row) |
| `BLOCKED` | fixture evidence or runtime prerequisite is broken — **0 tools classified BLOCKED** (every tool has a PASS fixture; the gap everywhere is missing admitted operations, not broken fixtures) |

## 4. Summary (honest)

- **1 / 36 READY** (`highs` solve-lp).
- **2 / 36 READY-VIA-V3-PLAN** (`z3`, `cvc5` solve-smt via #183).
- **33 / 36 FIXTURE_ONLY.**
- **User-operation coverage is NOT universal.** Do not represent the 36/36 fixture ledger as 36 usable operations; the ledger itself warns against exactly that conflation.
- 7 tools have `INEFFECTIVE_OUTPUT` version probes (`aflpp`, `alloy`, `apalache`, `causal-learn`, `fast-check`, `highs`, `nuxmv`): for these, *version identity* rests on recorded meta/drift notes, not a live self-report. This degrades identification, not the fixture evidence.

## 5. Native catalog lane (13 tools)

Adapter for all rows: `NATIVE_CATALOG_13` — `planNative`/`executeNativePlan` (`packages/runner/js/native.mjs`), catalog `packages/runner/js/native-catalog.mjs`. Operations listed are the curated typed ops (`tool/op` plans); execution is trusted-local CLI only, timeout-capped 1–120 s, output-capped 1 MiB.

Fixture status column = `CAPABILITY_VALIDATION.json` row (receipt under `docs/tool-portfolio/r176/receipts/<id>/receipt.json`, r181 for `nuxmv`/`prob`).

| tool | pin (DAG) | probed | probe | fixture | user-operation status | typed ops (catalog, trusted-local only) | input → output | host prereqs |
|---|---|---|---|---|---|---|---|---|
| alloy | 6.2.0 | — | INEFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | exec, help, lsp | `.als` module → counterexample / scoped SAT-UNSAT | `FORMAL_ALLOY_JAR` or `FORMAL_ALLOY_BIN` (Grafana Alloy collision guard) |
| apache-jena | 5.5.0 | 5.5.0 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | validate, convert, query, parsequery, parseupdate, update | RDF docs + SPARQL → validation / results / converted graph | `riot`/`arq` on PATH or `FORMAL_TOOLS_BIN_DIR` |
| apalache | 0.63.0 | 0.29.0 (banner) | INEFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | check, parse, typecheck, simulate, test | `.tla` spec → NoError/Error outcome, counterexample | `apalache-mc` on PATH |
| clingo | 5.8.3 | 5.8.3 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | solve, ground, solve-json | `.lp` ASP → stable models / optimal value | `FORMAL_CLINGO_BIN` (pinned binary) or `FORMAL_CLINGO_PYTHON` |
| cvc5 | 1.4.2 | 1.4.2 | EFFECTIVE | PASS pos/neg/err | **READY-VIA-V3-PLAN** (#183 solve-smt) | solve, sygus | `.smt2` → sat/unsat/unknown + model/proof/unsat-core | `cvc5` on PATH (bundle binary validated: 1.4.2) |
| dafny | 4.11.0 | 4.11.0 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | verify, resolve, build, run, test, format-check, format-print | `.dfy` → verification report / executable | `dafny` on PATH |
| lean4 | 4.35.0 | 4.35.0 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | check, build, test, lint, query | `.lean` → diagnostics / `.olean` | `lean`/`lake` on PATH |
| prob | 1.16.1 | 1.16.1-final | EFFECTIVE | PASS setup/pos/neg/err | FIXTURE_ONLY | check, bounded, animate, no-deadlock | `.mch` B machine → counterexample / check report | `probcli` on PATH |
| rdf-shacl | 0.40.2 | 0.40.2 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | validate | RDF data + SHACL shapes → conforms + violations | `FORMAL_PYSHACL_PYTHON` (default `python3 -m pyshacl`) |
| souffle | 2.5 | 2.5 | EFFECTIVE | PASS pos/err | FIXTURE_ONLY | run, compile, generate, parse | `.dl` + `.facts` → derived relations / binary | `souffle` on PATH |
| tla-tlc | 1.8.0 | 2026.11.06.222357 (rolling jar) | EFFECTIVE | PASS setup/pos/neg | FIXTURE_ONLY | check, simulate, parse, pluscal, xml | `.tla`+`.cfg` → model-check verdict / trace | `TLA2TOOLS_JAR` |
| vampire | 5.1.0 | 5.1.0 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | prove, casc, casc-sat | `.p` TPTP → SZS status / proof | `vampire` on PATH |
| z3 | 5.4.0 | 5.4.0 | EFFECTIVE | PASS pos/neg/err | **READY-VIA-V3-PLAN** (#183 solve-smt) | solve, dimacs | `.smt2`/`.dimacs` → sat/unsat/unknown + model | `z3` on PATH (bundle binary validated: 5.4.0) |

Notes:
- `z3`/`cvc5`: the catalog typed ops (`z3/solve`, `cvc5/solve`) and the committed fixture interpreter (`interpret`) exist, so the V3 adapter can be thin — but until #183 lands, no workflow-level typed solve-smt user operation is admitted. Scenario A below therefore validates the *solvers and inputs* directly on the pinned binaries and records the runner path as planned.
- `interpretNativeObservation` keeps `test_verdict: NOT_EVALUATED` by design: solver output is an observation, never an acceptance verdict.

## 6. Portfolio lane (23 candidate tools)

Gateway: `packages/runner/js/tool-portfolio-t4.mjs`. Every row requires a Debian 13 x86_64 host with `FORMAL_PORTABLE_ROOT` (pinned #24 bundle) and `FORMAL_PORTABLE_RUNNER_SHA256`; metadata/fixture/script bytes are SHA-verified per invocation (fail-closed on any mismatch). Fixture status = `CAPABILITY_VALIDATION.json` row.

| tool | pin (DAG) | probed | probe | fixture | user-operation status | adapter | input → output (capability io) |
|---|---|---|---|---|---|---|---|
| aflpp | 5.03c | 3.13 (loader error) | INEFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | instrumented target + seeds → crashing inputs |
| causal-learn | 0.1.4.8 | — | INEFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | data matrix → causal graph + scores |
| cbmc | 6.11.0 | 6.11.0 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | C source + bounds → per-property verdict + trace |
| dowhy | 0.14 | 0.14 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | DataFrame + causal graph → effect estimate + refutations |
| elk | 0.6.0 | 0.6.0 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | OWL 2 EL ontology → hierarchy + consistency |
| fast-check | 4.10.2 | 22.16.0 (Node banner) | INEFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | property functions → falsifying case |
| fast-downward | 24.06 | 26.6 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | PDDL/SAS+ → action plan |
| **highs** | **1.15.1** | — (no `__version__`; runtime-pinned 1.15.1 by script) | INEFFECTIVE | PASS pos/neg | **READY** | PORTABLE_TYPED_PYTHON_LIBRARY_CANDIDATE | LP model JSON (`sense/objective/variables/constraints`, ≤64 vars, ≤128 rows, ≤64 KiB) → `kOptimal`(+objective+variables) / `kInfeasible` / `kUnbounded` / `kTimeLimit` JSON |
| hypothesis | 6.170.15 | 6.170.15 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | Python property + strategies → shrunk counterexample |
| kani | 0.68.0 | 0.68.0 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | Rust harness → verdict + counterexample |
| mesa | 3.5.2 | 3.5.2 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | Python ABM → per-step state series |
| minizinc | 2.10.1 | 2.10.1 | EFFECTIVE | PASS pos/neg/err | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | `.mzn`+data → solutions / objective |
| networkx | 3.7 | 3.7 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | graph object/file → metrics, paths |
| nuxmv | 2.2.0 | — (binary rejects `--version`, rc=255) | INEFFECTIVE | PASS pos/neg/err (r181 receipt) | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | `.smv` → property verdict / trace |
| ortools | 9.15.6755 | 9.15.6755 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | CP-SAT/MPSolver models → status + assignment |
| prism | 4.11 | 4.11 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | `.pm` + PCTL/CSL → probabilities / witness |
| pymc | 6.4.0 | 6.4.0 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | PyMC model + data → posterior samples |
| robot | 1.9.11 | 1.9.11 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | OWL/OBO + templates → merged/converted ontology |
| simpy | 4.1.2 | 4.1.2 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | SimPy process model → event log + stats |
| storm | 1.8.0 | 1.8.0 (meta declares 2.0.0) | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | `.prism`/`.jani` → probabilities / scheduler |
| sympy | 1.14.0 | 1.14.0 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | symbolic expr → simplified/solved form |
| tree-sitter | 0.27.2 | 0.27.2 | EFFECTIVE | PASS pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | source + query → syntax tree / matches |
| why3 | 1.8.0 | 1.8.0 | EFFECTIVE | PASS setup/pos/neg | FIXTURE_ONLY | PORTABLE_FIXTURE_GATE_ONLY | `.mlw`/`.why` → verification conditions + prover results |

`highs` READY specifics (evidence: `docs/tool-portfolio/r20/HIGHS_TYPED_OPERATION.json`, `tests/highs-typed-operation.test.mjs`, pinned script `portable/verification/cases/highs/solve-lp.py` sha256 `6b43add5…39136` = JS pin `highsSolveScriptSha256`):
- Callers: SDK (`planPortfolioOperation`/`runPortfolioOperation`), CLI (`portfolio invoke highs solve-lp --model <file> [--timeout N]`), MCP (`run_portfolio_operation`).
- Budget: 1–64 variables, 0–128 constraints, ≤64 KiB input, `timeoutS` integer 1–30 (solver limit `timeoutS-0.5`).
- Fail-closed pins: runner SHA (`FORMAL_PORTABLE_RUNNER_SHA256`), optional meta/fixture pins, script SHA, `highspy==1.15.1`, `python==3.13.5`, `numpy>=2.1`, `solver_api_status==kOk`, strict result schema; status `T4_OPERATION_EXECUTED_UNREVIEWED`, qualification `NOT_T4_ACCEPTED_INDEPENDENT_REVIEW_PENDING`.

## 7. Honest gaps

1. **Coverage**: 33/36 tools have no caller-controlled typed operation. The 36/36 ledger is fixture evidence only.
2. **Version identity**: 7 tools have ineffective version probes (see §4); `storm` and `tla-tlc` carry recorded drift; `fast-downward` probes 26.6 against meta 24.06.
3. **Scenario B canonical-bundle gap (found by this validation, recorded not hidden)**: the deployed bundle at `/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64` ships a **pre-r20** `tests/highs/solve-lp.py` (sha256 `869a341e76139131eea9fb22c6a152d5e4fdca9dc604160cc6d0b41109030b20` — lacks the python-version gate, numpy ≥2.1 floor and `value_valid` check). The full JS receipt path against that root fails closed with `HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH` (by design). A genuine T4 receipt was obtained on the host against a minimal standalone root carrying the exact repo-pinned script bytes and the same bundled runtime (see `docs/mvp/SCENARIOS.json` → scenario B `host_validated_evidence.js_receipt_path`). Until the bundle refreshes its script copy, the READY classification for `highs` holds at the code level (main @ `33bd3d0`) but the canonical bundle instance needs a refresh for the JS path to run against it unmodified.
4. **z3/cvc5**: READY-VIA-V3-PLAN only; #183 must add the workflow-executor solve-smt operation before scenario A can be expressed as typed calls.

## 8. MVP cross-tool scenarios

`docs/mvp/SCENARIOS.json` (schema `formal-tools/mvp-scenarios/1.0`) defines, with real host-captured evidence from 2026-11-19 (trusted host `cc@192.168.100.200`, pinned bundle):

- **A `smt-cross-check`** — QF_LIA pair solved by z3 5.4.0 and cvc5 1.4.2: A1 `AGREE_UNSAT` (x≥0, y≥0, x+y≤2, x≥3), A2 `AGREE_SAT` with unique model x=2,y=3. Both tools agree on both files; malformed-SMT negative produces parse errors (rc=1) from both.
- **B `highs-lp`** — two models passing the real `validateHighsModel`: feasible → `kOptimal`, objective 12, variables [4,0]; infeasible → `kInfeasible`. Validated twice: manual runner reproduction on the canonical bundle, and the full JS receipt path (`T4_OPERATION_EXECUTED_UNREVIEWED`) against a minimal root with the repo-pinned script.
- **Negatives** (5): unknown tool id, tampered runner/script hash, timeout budget exhaustion, tool disagreement, malformed SMT input — each with live capture or explicit committed-test attribution.

## 9. Handoff to V2/V3 (and #180)

- V2 can extend scenario coverage only through already-admitted operations; do not widen `planPortfolioOperation` beyond `highs`/`solve-lp` without a new #24-scoped decision.
- V3 (#183) should (a) admit `solve-smt` for z3/cvc5 so scenario A becomes typed, (b) re-run scenario B's JS path directly against the canonical bundle after its script refresh lands, and (c) treat the 33 FIXTURE_ONLY tools as candidates for per-tool operation requests filed on their existing #24 issues (no duplicate writers).
- The canonical-bundle script drift (§7.3) should be picked up by the #24 bundle-refresh owner; the repo pin is authoritative.
