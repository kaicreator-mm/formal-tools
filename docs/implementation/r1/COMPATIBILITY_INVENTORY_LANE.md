# D09 parallel preparation — tool compatibility inventory

This is a **tool-only, source-derived** 13-family inventory. It is independent of the local Agent's PR #9 Tool Registry/diagnostic write set.

```bash
node scripts/tool-compatibility.mjs <FULL_40_CHAR_GIT_COMMIT_SHA>
```

It reads the authoritative `native-catalog.mjs` for IDs, native entrypoints, official documentation and typed operation counts. It does not hard-code a second list, call the network, download, install or execute solvers.

The `buildCompatibilityMatrix` function can optionally receive exact-SHA host observations for each tool. An observation from another commit is always `STALE_SHA`; same-SHA observations remain `REPORTED_UNREVIEWED` until actual runtime receipts receive independent acceptance. No report is elevated to OS/binary compatibility PASS on the strength of a declarative record alone.

This is **D09 source preparation**, not a substitute for a real Windows/Linux compatibility test, not a user-facing recommendation about which solver to use, and not a business model evaluation.

Related independent source lane: [artifact inventory](ARTIFACT_INVENTORY_LANE.md). Neither module is wired into PR #9's `native.mjs`, `sdk.mjs`, `cli.mjs`, `package.json` or `.woodpecker/` yet. Integration should occur only after PR #9's Agent finishes and write-set ownership transfers.

## Multi-platform/version observations

One tool can have multiple observations across Windows/Linux, architectures and upstream versions. Per-tool `observation_status` summarizes whether any report targets the exact requested SHA; each observation retains its own `STALE_SHA` or `REPORTED_UNREVIEWED` flag. Duplicate tool/OS/arch/version/SHA tuples are rejected. No status equals a real compatibility PASS; a reviewer must still verify native receipts.

## Read-only host observation import

```sh
node scripts/tool-compatibility.mjs <EXACT_40_CHAR_SHA> --observations path/to/host-observations.json
```

The observations JSON contains an array or `{"observations":[...]}` with `tool_id`, `git_head`, `platform`, `arch`, optional `tool_version`, optional `evidence_sha256` and a **technical-only** `run_status`. The importer does not execute any engine or grant a PASS verdict. `run_status=PASS` is explicitly rejected; only technical statuses such as EXECUTED, NOT_RUN, TIMEOUT or INCONCLUSIVE are accepted. The report supports multiple OS and upstream-version observations per tool.
