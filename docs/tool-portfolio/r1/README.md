# Formal Tools — 36-Tool Portfolio R1

This directory captures the **tool maintenance inventory**, not the G0–G6 product completion status.

- Product/G0–G6 authority: [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11)
- Tool lifecycle and shared runtime authority: [Issue #24](https://github.com/kaicreator-mm/formal-tools/issues/24)
- One lifecycle Issue per tool: [#25–#60](https://github.com/kaicreator-mm/formal-tools/issues/24)
- Existing R2 CLI/MCP/Woodpecker acceptance: [Issue #4](https://github.com/kaicreator-mm/formal-tools/issues/4)
- Historical R1 #7 remains closed; do not reopen or claim its gates for this portfolio.
- [Debian13 independent R3 receipt](https://github.com/kaicreator-mm/formal-tools/issues/11#issuecomment-6824089200) and [Drive verified source-bundle copies](https://drive.google.com/drive/folders/1RH31lRIMZHWp5OluomuVTu479lquiMFD) are **separate from PR#22 source/CI review and G3 business semantics**.

## Source of truth and update workflow

The file [TOOL_PORTFOLIO_DAG.json](./TOOL_PORTFOLIO_DAG.json) stores:
1. The 36 canonical tool slugs, versions, bundle filenames, and stable GitHub Issue IDs.
2. Pinned dependencies on portable core, Node22, JRE21, Python313, other runtimes, or another tool.
3. The R3 fixture/environment verdict for **the source bundle that was actually tested**, not a rebuilt binary with a different SHA.
4. An explicit T0–T6 gate-state snapshot for each tool; all T4/T5 and unreviewed T1 remain unqualified.
5. Shared-blocker tasks and their dependency DAG, owned by Issue #24.

### Status and evidence invariants

- `ENV_PASS`: real tool process and a **scoped** fixture passed, with archive SHA linked to the independent R3 receipt. No implied proof of unseen inputs or projects.
- `MANUAL_PARTIAL`: selected manual tests ran, but official runner/doctor qualification remains missing; not a full pass.
- `NOT_RUN_RUNTIME_UNAVAILABLE`: a required portable runtime was absent. Tree-sitter only passed a CLI version probe.
- `NOT_RUN_TRANSPORT_413`: archive could not be transferred; tool cannot be evaluated.
- `NOT_RUN_EXECUTION_SERVICE`: the host failed before any trustworthy tool semantic verdict; do not mark the tool broken.
- `PRECHECK_REJECTED`: safety preflight rejected archive members/symlinks. Never weaken extraction globally without an audited confined exception.
- `REWORK_NOT_VERIFIED`: observed runner/parser errors or wrong exit behavior require targeted root-cause analysis.

A new tool version, changed source binary, changed runner, changed fixture, changed semantic Oracle or release changes may stale prior receipts. Update only the affected gates after new native and independent review. **Never copy `ENV_PASS` into `T5` or the product G3–G6 gates.**

## Workflow

- Keep the issue named for the tool as the long-lived task entry; create separate bug/issues only for independently actionable maintenance that needs distinct ownership and link them back.
- For tool-source changes, preserve a single legal Writer per PR; combine bug repair with the necessary regression and exact-SHA evidence. Conflict-free tools may proceed in parallel.
- Source assets and whole-archive SHA hashes remain in Drive `App/packages`; pass-qualified copies go to `App/formal-tools-verified-debian13-x86_64` **only after actual tested evidence**, and the source files must remain unchanged.
- Shared runtime/core/execution-host work is coordinated in Issue #24 and must not be duplicated across 36 separate tool writers.
- Reuse unchanged existing R3 scoped verdicts. Genuinely qualified independent Source-First Oracle and true platform execution are required separately for real ADS/DKE/DIS use.
- Use Woodpecker and node test tooling; **no GitHub Actions**.

## Validation

```sh
node --test tests/tool-portfolio-dag.test.mjs
# or alongside repo's existing JS test suite:
npm run formal:test
```

The test checks all 36 issue references, stable tool IDs, matching archive names, R3 status counts, fail-closed T5, shared dependency keys and acyclicity for gate/repair DAG. It does **not** execute native tool binaries or certify their semantics.

**Snapshot 2026-11-12:** 16/36 Debian13 fixture `ENV_PASS`, 20/36 not fully qualified. All 36 trackers remain open for their independent build/integration/real-use qualification. This R1 inventory update does not imply any new program release.
