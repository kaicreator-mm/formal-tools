# S5 forensics — trusted-bundle drift blocks the HiGHS typed operation (P2, environment)

Validator: i180/R3 non-Writer E2E validator D, 2026-11-20. No product source was
modified; everything below is recorded as found.

## Symptom

The R3 optimize arm (S5b: approve an integer optimize model with
`lpRelaxationAcknowledged: true` -> plan -> REAL HiGHS) fails closed on BOTH
trusted bundle images currently present on CC-LAN200 when the repo at
7eec0f25d067665ad2b68bca275a53c2ea1c25b2 drives them:

1. **formal-tools:deb13-r0** (the container the R3 brief/C's launcher validation
   used, `FORMAL_PORTABLE_RUNNER_SHA256=0db55eab9c1b1006289030203e97002d89a61e37b9756697070e7a9470212e17`):
   - `tools/highs/meta.json` carries `"version": "unknown"` (builder note:
     highspy exposes no top-level `__version__`), while the repo's frozen DAG
     `docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json` pins highs `1.15.1`
     (`packages/runner/js/tool-portfolio-t4.mjs` `versionById`).
   - Executor refuses before any step: receipt `overall.process_outcome=FAILED`,
     `fail_closed_reason=HIGHS_ADAPTER_FAIL_CLOSED`, step error
     `PORTABLE_VERSION_DRIFT_EXPECTED_1.15.1`
     (browser journey receipt preserved: `05-failed-run-receipt.json`,
     run_id `run-mwnvta8s-f2907b4f`, screenshot
     `04-run-failed-highs-adapter-fail-closed.png`).
   - r0 additionally lacks `tests/highs/solve-lp.py` entirely.

2. **formal-tools:deb13-r1** (image id dd7fe24b49b2, built 2026-11-19 16:22 +0800,
   runner sha `020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a`):
   - `tools/highs/meta.json` version is correctly `1.15.1`, but its
     `tests/highs/solve-lp.py` hashes to `869a341e76139131eea9fb22c6a152d5e4fdca9dc604160cc6d0b41109030b20`
     while the repo pins (and ships, at
     `portable/verification/cases/highs/solve-lp.py`) `6b43add5fbb8dc3b2aa65b951f85d9ee41f7827921d8d624588fe3aaae339136`.
   - Result: same honest fail-closed, step error
     `HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH`
     (API-mirror run `run-mwnwdacj-b75667ab`, outcome FAILED; the receipt lived
     in the throwaway container and was not retained — the failure is
     deterministic from the two hashes above and re-derivable at will).

## Why this is recorded as environment drift, not an R3 code defect

* The fail-closed behavior itself is CORRECT and honest: no fake result, the UI
  renders `FAIL-CLOSED` with `no trustworthy result is claimed` and keeps the
  LP_RELAXATION_ONLY caveats (`04-…png`, `05-failed-run-receipt.json`).
* R2's committed live evidence (this repo,
  `validation/mvp-user-e2e/evidence/r2/`, journeys of 2026-11-19, runner sha
  `020f8f5e…`) PROVED the same repo-family + a bundle whose highs script
  matched the pin executes HiGHS `kOptimal` for real. The pin-bearing check
  (`2e8f066`, 2026-11-15) predates those runs, so the r1 image contents must
  have drifted AFTER R2's LP journey (the current r1 image was built
  2026-11-19 16:22 +0800 with a stale script).
* Both failing checks are supply-chain integrity gates doing exactly their job.

## How S5(b) was still proven REAL (disclosed evidence-environment repair)

A throwaway container (never the shared `formal-tools-ssh`, no shared volume or
image mutated) was started from `formal-tools:deb13-r1` with exactly ONE file
overridden by a READ-ONLY bind mount:
`/home/cc/formal-tools/tests/highs/solve-lp.py` <= repo canonical
`portable/verification/cases/highs/solve-lp.py` (sha256
`6b43add5fbb8dc3b2aa65b951f85d9ee41f7827921d8d624588fe3aaae339136`, verified
identical on both sides before start). The bundle's own integrity gates then
PASS on their own authority (version gate + script-pin gate) and the typed
operation executes for real. With that, the browser journey S5(b) ran
end-to-end: approve with the explicit ack -> LP plan -> REAL HiGHS
(highspy 1.15.1 / Python 3.13.5 / numpy 2.5.4) -> `kOptimal`, objective
**2.5** (continuous LP relaxation optimum; the integer optimum of
max x, 2x<=5, x in [0,10] is 2 — 2.5 !== 2, exactly the honesty property the
R3 seam must demonstrate). Receipts: `06-…json` through `12-…json`,
screenshots `01-…png`/`02-…png`/`03-…png`/`10-…png`.

## Requested follow-up (for the Writer/ops, not fixable by a validator)

Rebuild/refresh the portable bundle images so that
`tests/highs/solve-lp.py` == `portable/verification/cases/highs/solve-lp.py`
(pin `6b43add5…`) and `tools/highs/meta.json` version == the DAG pin
(`1.15.1`) — a single deb13-r1 image refresh removes the need for the
evidence-environment repair above. Until then every integer-optimize approval
with the LP acknowledgement fails honestly closed on both published images.
