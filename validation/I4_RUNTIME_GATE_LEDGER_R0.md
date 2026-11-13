# Issue #4 — 13-tool Runtime Gate reconciliation (R0, 2026-11-13)

Scope: **kaicreator-mm/formal-tools#4 only**, original R4 JS/TS CLI + SDK + MCP for 13 tool families / 53 typed operations / 26 positive and negative fixtures. Tool Portfolio #24 owns the separate 23-tool T4 expansion; Product #11 owns Source/Oracle/Solution. Closed #7/#14 stay untouched.

## Frozen GitHub facts

- Main at assessment: `98c71e90cbc091a1e57c2241222c78f0c55f4330` (PR #65 merge, docs-only vault inventory).
- Original R4 native Linux run: `f945fc50751f71e120c355661d63cce4f7041ea4`, Issue #4 comment 6748844094 / `validation/R4_RUNTIME_ACCEPTANCE_SUMMARY.json`: 13/13 doctor, 26/26 fixtures, 53 plans (49 safe smokes, 4 excluded), 12/12 MCP SDK v2 real handshake. **Local-agent reported**; raw `_tmp/r4-accept` output not retained in this Git repository. Workspace isolation was changed afterward.
- PR #9 Windows host: `validation/local-runtime-receipts/R1_LOCAL_RUNTIME_ACCEPTANCE.json`, `native-acceptance.json`, `mcp-acceptance.json`; 9 registered MCP tools live stdio 13/13 assertions (host without engines), 26 native attempts INCONCLUSIVE, no solver-version PASS.
- Woodpecker local backend runs as `image: bash`, not a Docker image. Historical #9/#10 on PR #9 final `fc8899a6b3fc69636fffdfbd17fc74f8b4fb63e4` SUCCESS; current main push #373 reports SUCCESS on GitHub combined status for `98c71e9`. This is JS/TS static and core execution, **not** 13 native tools.
- Main after merged PR #10 is ahead in `scripts/native-acceptance.mjs` due receipt privacy changes; don't inherit old acceptance script semantics unconditionally.

## Bounded technical gate matrix

| Gate | Reusable at named scope | Still necessary to close #4 |
| --- | --- | --- |
| CLI + 13 tool registry, 53 typed operation plans | Source incorporated; Linux R4 typed-smoke historical | On updated contract, sampled real version-dependent flags and actual CLI command exits; full plan comparison only where changed |
| Node tests + TypeScript | Historical actual Woodpecker + main #373 SUCCESS | For any repair PR, its own exact-HEAD CI SUCCESS |
| MCP stdio | PR #9 actual Windows 9-tool handshake and rejection; host has no engines | Affected changes only; MCP native installed call receipts and independent host/permissions classification where not previously proven |
| Native | Old 13/13/26/26 at R4 pre-isolation SHA | Current source+tool+fixture exact-SHA: version/help, 26 pos/neg, error/UNKNOWN, stdout/stderr, exit, binary and JAR hash, permissions and isolation |
| SDK staged invocation | Source / prior CI and missing-executable fail-closed tests | Installed-engine runtime, success/error/timeout/artifact provenance on real host |
| Woodpecker | Main #373 SUCCESS (static workflow) | Any new repair PR exact HEAD, then merged main; no imaginary native CI |
| Independent review | Historical source reviews bounded to prior commits | Fresh non-writer exact-HEAD source/evidence review before final close |

## Confirmed receipt provenance defect addressed by this PR

The prior `scripts/native-acceptance.mjs` did not embed the actual Git commit and only attempted executable SHA on `launcher=binary`. JAR-backed tools such as TLC and Alloy need explicit dependency checksums; otherwise the new receipt cannot substantiate per-release source/runtime identity.

The repair adds `source_identity` (git SHA + CLEAN/DIRTY/UNVERIFIED), streamed SHA-256 identity for resolved executables, and `dependency_identities` for authoritative `planToolProbe().requiredFiles` (Java/JAR and Alloy configurations). A test protects digest/bytes, Git identity classification and path redaction. **Python-module dependency package/wheel hashing remains a separate package T0/T1/T3 evidence requirement, not implied by hashing its interpreter.** There is no new native PASS from this source change.

## Critical path / validation responsibility

One engine-provisioned Linux host, or independently qualified per-tool host subsets, must check out the **actual current PR/merge SHA cleanly**, use canonical immutable App assets (#24 catalog), and run only invalidated native/CLI/SDK/MCP gates. Repair actual observed P0/P1 in one source writer, record exact source and tool hashes, negative/error/timeout, stdout/stderr SHA and exit. Emit `BLOCK_OR_REPAIR` or `INCONCLUSIVE` rather than a fabricated PASS for unavailable engines. Source-level CI and portable asset availability are not substitutes.

Receipt consumer must check `source_identity.status === "CLEAN"`, exact expected SHA, complete tool binary/JAR/module provenance and schema. A `CANDIDATE_FOR_REVIEW` fixture status is not an accepted professional proof.

## R0 real-engine-host receipts (2026-11-13, appended — prior history above unchanged)

Engine-provisioned Linux host (CC-LAN200, canonical `#24` deb13 bundle, non-root uid,
bundle write-denied) checked out the repair branch cleanly at each step and ran only the
invalidated native/CLI/SDK/MCP gates. Full recipe, per-tool identities and raw evidence:
[local-runtime-receipts/i4-r0/README-I4-R0-RUNTIME-GATE.md](local-runtime-receipts/i4-r0/README-I4-R0-RUNTIME-GATE.md).

- Receipt `acceptance/native-acceptance.json` (schema `formal-native-local-acceptance/1.3`):
  `source_identity = CLEAN @ 5d8a10e3fdb4db0d36d224706f86cbba4efb07ec`; **12/13
  CANDIDATE_FOR_REVIEW** with real engine executions (versions in receipt: lean4 4.35.0,
  z3 5.4.0, cvc5 1.4.2, TLC2 2026.11.06 + tla2tools.jar sha, apalache 0.63.0, alloy 6.2.0 +
  jar sha, souffle 2.5, pySHACL 0.40.2, vampire 5.1.0, jena riot/arq 5.5.0, prob 1.16.1,
  dafny 4.11.0), **26/26 fixtures EXECUTED with per-fixture input sha256**, pos+neg PASS
  for 12; z3/cvc5 extra `error_input` (real parser error, never a verdict) and
  `unknown_scope` (bounded TIMEOUT) recorded as visibly distinct outcomes.
  **clingo = INCONCLUSIVE (BLOCK)**: canonical bundle ships only the 5.8.3 native binary;
  the python-module runtime the runner contract requires is not provisioned — no fabricated
  PASS, asset gap recorded for #24.
- CLI gate: 43/43 commands with true exit codes (typed version-dependent flags on 12
  families, 6 native-help probes, 6 fail-closed error paths, pure engines, tracked tree
  clean after runs). SDK staged gate: 10/10 (hashed generated artifacts, TIMEOUT→PARTIAL,
  traversal/absolute/unstaged denials, missing-engine fail-closed, raw pass-through
  denied). MCP stdio gate: 8/8 (real handshake protocol `2025-06-18`, installed z3 probe
  + installed fixture PASS, plan valid/invalid semantics, no raw surface, clean exit).
- Repairs observed on the real host and fixed in this branch (single Writer):
  privacy scan vs verbatim streams contradiction (`8f72b12`), `npm ci` workspace-bin
  mode change falsifying `source_identity` (`449f605`), Jena 5.x IRI validation
  rejecting the committed `<urn:a>` fixtures (`01789b2`), gate-driver determinism
  (`81b1445`,`c8dc339`,`5d8a10e`). Each has local `node --test` + `tsc --noEmit`
  regression and exact-HEAD Woodpecker SUCCESS (#430/#441/#443/#450/#453/#459; #435 was
  a clone network transient superseded by same-SHA rerun #441).
- Remaining for closeout: independent non-Writer review of this evidence set at the
  final exact HEAD; merge; merged-main CI. Product #11 T5/Oracle stays out of scope.

Links: [#4](https://github.com/kaicreator-mm/formal-tools/issues/4), [#24](https://github.com/kaicreator-mm/formal-tools/issues/24), [#11](https://github.com/kaicreator-mm/formal-tools/issues/11), [R4 source review](R4_FRESH_SOURCE_REVIEW.md).
