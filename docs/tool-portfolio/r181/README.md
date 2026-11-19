# r181 — refreshed-image capability sweep (nuxmv/prob rebind)

Round: r181 (Issue #176, product baseline #11 closed/frozen; portfolio authority #24).
Base main: `a7fb23f1ece5b44dd55affcec456fdac04085168`.

## Why

The r176 sweep ran against the deployed `formal-tools:deb13-r0` image (built
2026-11-12 00:44 +0800), which predates the merged portable-lane restores of
nuxmv 2.2.0 and prob 1.16.1. Both tools verified SKIP/UNAVAILABLE in that image,
so their ledger rows cited the merged portable-lane verify receipts
(`PORTABLE_LANE_PASS_SCOPED`) with honest container-skip receipts retained
under `docs/tool-portfolio/r176/receipts/`.

The server's assembled bundle (`out/bundle/formal-tools-portable-debian13-x86_64`,
refreshed 2026-11-12 23:53 +0800) already contains all 36 tools including both
restores — only the docker image was stale. r181 rebuilt the image as
`formal-tools:deb13-r1` (13.3 GB, built 2026-11-19) from that bundle and re-ran
the same proven sweep harness in an ephemeral container.

## What is committed here

- `SWEEP_SUMMARY.json` — whole-sweep summary of the r181 run: **36/36 verify
  PASS** in the refreshed image (r0: 34 PASS + 2 SKIP). Deployment string is
  truthful for this run (`formal-tools:deb13-r1`, ephemeral container,
  `network=none`).
- `receipts/nuxmv/`, `receipts/prob/` — the two rebound tools' receipts
  (receipt.json + probe.txt + verify.tsv), byte-identical to the sweep output.
  These are the ledger's new `evidence_ref` targets, sha256-bound in
  `registry/CAPABILITY_VALIDATION.json`.
- `SHA256SUMS` — over the committed files only.

The full 36-receipt sweep output remains on the build server at
`out/r181-sweep/` (cc@192.168.100.200); the other 34 tools keep their r176
receipt bindings unchanged (their probes and verdicts were re-observed PASS in
this sweep; no ledger change was needed for them).

## Facts observed

| tool | verify (r1 container) | live version probe | ledger transition |
|---|---|---|---|
| nuxmv | PASS (pos/neg/err, runner_schema 0.2) | `--version` rejected: rc=255, unknown-option banner → INEFFECTIVE_OUTPUT, probed_version stays null (meta-declared 2.2.0) | PORTABLE_LANE → NATIVE_PROBE_PASS_SCOPED |
| prob | PASS (setup/pos/neg/err, runner_schema 0.2) | rc=0 banner self-reports `VERSION 1.16.1-final` (git 716929f5) → EFFECTIVE, probed_version `1.16.1-final`; drift record notes the final-build suffix of declared 1.16.1 | PORTABLE_LANE → NATIVE_PROBE_PASS_SCOPED |

Environment pins (identical for both receipts): bundle_manifest_sha256
`fc2897bd03782d8eacd39381dcfd8466416d075cbabe80fdcd14efc3fa3e04dc`,
tool_runner_sha256
`020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a`,
executed 2026-11-19T08:28:05Z. Also recorded in
`registry/CAPABILITY_VALIDATION.json` → `authority.r181_refresh`.

## Discipline

- Zero tool re-install, zero bundle rebuild: image rebuilt from the existing
  assembled bundle; the deployed `formal-tools-ssh` container (deb13-r0) was
  NOT touched — `deb13-r1` is a separate verify-only tag.
- Sweep re-executes each tool's proven verify fixtures via the bundle's own
  `bin/tool-runner verify` (the designed cheap lane), plus best-effort live
  version probes. No T3/T4/T5/T6/Product/Release promotion: capability probe
  receipts remain technical evidence only.
- The G1 discovery registry (`registry/PROBLEM_CAPABILITIES.json`) is
  byte-unchanged; the r176 evidence tree is frozen history.
