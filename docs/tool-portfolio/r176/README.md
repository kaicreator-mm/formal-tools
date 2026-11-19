# r176 — I24/I11 36-tool capability probe & validation lane

OUTPUT_LABEL=FORMAL_TOOLS_I24_I11_36_TOOL_INCREMENTAL_REUSE

## What this lane is

One authoritative capability-probe sweep over the **deployed** portable bundle
(`formal-tools:deb13-r0`, container `formal-tools-ssh` on `cc@192.168.100.200:2222`),
plus a machine-readable validation ledger binding each registered tool's
capability mapping to its actual native execution evidence.

- Frozen G1 discovery index `registry/PROBLEM_CAPABILITIES.json` (schema 0.1) is
  **byte-unchanged**: it remains the only source of capability vocabulary
  (23 capabilities) and tool→capability mapping (36 tools, 13 native-ref + 23
  candidates). Its DISCOVERY_ONLY semantics stay intact and independently tested.
- New ledger `registry/CAPABILITY_VALIDATION.json` (schema
  `formal-tools/capability-validation/0.1`) overlays per-tool validated state
  with sha256-bound receipts under `receipts/`.
- New module `packages/runner/js/capability-validation.mjs` +
  standalone CLI `packages/runner/js/capabilities-cli.mjs` expose deterministic
  `matchValidatedTools` / summary / per-tool reads. `cli.mjs`, `sdk.mjs`,
  `mcp.mjs` are deliberately untouched: their git blobs are pinned by
  `docs/tool-portfolio/r99/CBMC_CURRENT_MAIN_T4.json` (cross-lane receipt);
  adding a subcommand there requires the pin-owning lane's reconciliation.

## Sweep facts (2026-11-19)

- Harness: `portable/scripts/i24-capability-probe-sweep.sh` — re-executes each
  tool's PROVEN verify fixtures (pos/neg/err via `bin/tool-runner verify <id>`)
  and adds a best-effort live version probe; one receipt JSON per tool with
  full IO logs, TSV rows, environment pins (bundle manifest sha256, runner
  sha256, deployment identity).
- Verify verdicts: **34/36 PASS** on the deployed bundle; `nuxmv`, `prob` are
  `SKIP/UNAVAILABLE` in that image (image built 2026-11-12 predates the merged
  portable-lane restores; their capability evidence cites the merged receipts
  `portable/status/receipts/verify-nuxmv.json` / `verify-prob.json` instead).
- Version probes: 28 EFFECTIVE, 6 INEFFECTIVE_OUTPUT (aflpp libpython path,
  alloy/apalache arg handling, fast-check node banner, causal-learn/highs
  missing `__version__`), 2 NOT_PROBED_UNAVAILABLE.
- Recorded version drift (observation, not a gate change): `storm` meta 2.0.0
  vs probed 1.8.0; `fast-downward` meta 24.06 vs probed 26.6+; `tla-tlc` meta
  1.8.0 vs probed TLC2 2026.11.06 rolling build.
- 9 python-lib tools had meta version `unknown`; probes recovered actual
  versions (sympy 1.14.0, networkx 3.7, pymc 6.4.0, dowhy 0.14, hypothesis
  6.170.15, simpy 4.1.2, mesa 3.5.2, ortools 9.15.6755, rdf-shacl 0.40.2).

## What this lane is NOT

Per `scope_rules` in the ledger and `semantics.warning`: capability-probe
receipts demonstrate the registered capability on the exact deployed bundle.
They are **not** formal T3 acceptance, T4 integration, T5 business
qualification, T6 maintenance, Product or Release grants. Issue #11 stays
closed with its frozen acceptance; portfolio authority is Issue #24.

## Reproduce

```sh
scp portable/scripts/i24-capability-probe-sweep.sh host:/tmp/
ssh host 'bash /tmp/i24-capability-probe-sweep.sh /opt/formal-tools-portable-debian13-x86_64 /tmp/cap-out'
```

`SWEEP_SUMMARY.json` mirrors the in-container summary; `SHA256SUMS` covers this
directory tree (receipts + summary + README + checkpoint).
