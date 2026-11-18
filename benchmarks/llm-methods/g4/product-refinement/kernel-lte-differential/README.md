# G4-P2 kernel-lte-differential — original Kernel live `lte` interpretation, differentially traced

Lane: **FORMAL_TOOLS_I11_G4_P2** single Writer, claim
[issuecomment-6960825898] on kaicreator-mm/formal-tools#11. Branch
`task/i11-g4-p2-lte-s3-io-bound-20261118`, base main
`401f3bb55f5095fb1f131f176b2ea157e3caa212` (post-#166-merge, CI #2073 SUCCESS).
Addresses **P2-1** of independent review
[#5945831322](https://github.com/kaicreator-mm/formal-tools/pull/166#pullrequestreview-5945831322)
(ACCEPT_SCOPED on merged #166): *"original Kernel live `lte` interpretation
still needs differential trace"*.

## What this is

A live differential trace between the ORIGINAL xDownload sealed kernel
interpreter and the merged #166 T03 model, over the
`guard:declared-bytes-ok` (`op: 'lte'`, `event.payload.declaredBytes` vs
literal 1 MiB) interpretation semantics — including the missing-field cases
the review called out.

| File | Content |
|---|---|
| `original-snapshot/kernel-mechanism-v1.mjs` | **byte-exact vendored** sealed kernel mechanism module of xDownload @ `e904f08c` (Git Blob `68b77d47`, sha256 `e1ed5955…`; original path `packages/download-domain-app/src/business/payloads/dist/kernel-mechanism-v1.mjs` — the `dist/` segment is excluded by the repo .gitignore, so the snapshot lives under `original-snapshot/` with the source path pinned in PROVENANCE); zero imports; integrity re-proven in tests by sha256 AND by recomputing the git blob sha1 from disk |
| `PROVENANCE.json` | pins, borrowed read-only inputs (#163 original policy snapshot, #166 T03 model), claim/review anchors |
| `DIFFERENTIAL.json` | the 19-case matrix with per-case live kernel guard + real central-admission + model observations, verdicts, and findings F1–F5 |
| `differential-drive.mjs` | evidence driver: prepared-guard path (`prepareDomainWorkflowGuard` → `evaluateDomainWorkflowGuard`, the exact line kernel `selectAdmittedTransition` runs), raw predicate path, and the REAL `admitCentralDecision` entry over the kernel's own `KernelGovernancePinStore`/`KernelBaselineStore` on a minimal CAS doc port |
| `tests/xdownload-kernel-lte-differential.test.mjs` | live replay of the committed receipt + explicit finding assertions |

## Results (live, node v24.21.0)

| Verdict | Count | Cases |
|---|---|---|
| `MATCH_ACQUIRE` | 5 | 0 / 1048575 / 1048576 (inclusive) / −1048576 / 0.5 |
| `MATCH_REFUSE` | 6 | absent field / '2000000' / 'abc' / 1048577 / 1 TiB / `{}` |
| `DIVERGE_MODEL_FAIL_OPEN` (F1) | 5 | null / '500000' / true / false / `[1]` — **model acquires where the kernel refuses** |
| `DIVERGE_KERNEL_ERROR_VS_MODEL_REFUSE` (F2) | 3 | undefined-valued key / NaN / Infinity — kernel fails typed at event preparation, model cleanly refuses |

Findings and honest boundaries are recorded machine-readably in
`DIFFERENTIAL.json` (`findings.F1`–`F5`):

- **F1** — the model's exported guard/decision layer is fail-open under JS
  loose coercion for five non-numeric shapes; the original kernel raises a
  typed ordered-comparison violation that `evaluateDomainWorkflowGuard`
  envelopes into guard-false, after which the REAL central admission admits
  the unguarded `refuse` transition. Not reachable through the composed
  T01→T03 path (T01 refuses every non safe-integer shape); recorded as a
  finding — **the H1 model is not modified in this lane**, hardening is a
  separate future claim.
- **F2** — undefined/NaN/Infinity fail the kernel's typed event preparation
  (`PredicateContractViolation`, e.g. `$event.payload.declaredBytes must
  contain JSON data only`), so no decision record is produced; the model
  produces a clean refuse. Same no-acquire direction, different observable.
- **F3** — the missing-field MATCH is outcome-equivalent but
  mechanism-different: kernel = MISSING sentinel → typed violation →
  enveloped false → refuse admitted; model = `undefined <= bound` coercion
  accident. The review's missing-field concern is answered at outcome level
  with the real mechanism now on record.
- **F4** — the profile bound alone does not encode positivity/integrality
  (0, negative, fractional all PASS the kernel guard); those are T01 grammar
  obligations. Model agrees numerically.
- **F5** — acquire-direction admissions stop typed at
  `ADMISSION_EFFECT_BINDING_UNVALIDATED`: the T03 dynamic
  `inputFrom`/`idempotencyKeyFrom` declarations require
  `createOccurrenceRuntime` wiring (the trusted load boundary, which also
  requires a Standard SDK endpoint). Out of lane scope, recorded as boundary.

## What this is NOT

- **No Effect executes anywhere** — no effect tools/journal/permit ports are
  wired; every completed admission in this lane is a refuse transition with
  zero effects (asserted in tests).
- **Engineering-only.** No Source Owner adoption, no independent
  professional Oracle, no trust roots (`G4_QUALIFICATION_ANCHORS.json` stays
  `NOT_CONFIGURED/[]`), no Qualified Solution, no positive Replay.
- The kernel snapshot is a **read-only evidence copy** pinned by digest; no
  behavior is imported into any product path of this repository.
- The five frozen SMT cases, the #163 crosswalk, the #166 model/witness
  files and all #24 tool files are untouched.

## Run

```sh
node --test tests/xdownload-kernel-lte-differential.test.mjs   # this lane only
node --test tests/*.test.mjs                                   # full repo suite (CI form)
```

Requires Node >= 24 (repo engine is >=20; the lane suite follows #166's
Node>=24 witness conventions). No dependencies.

## Review protocol

Delivery comment binds exact HEAD SHA + Woodpecker pipelines. Independent
Source-First review (different conversation) judges: write-scope
containment, vendored-snapshot integrity method, differential verdict
faithfulness, and the engineering-only/no-effect limits. Review acceptance
grants scoped engineering credit only — never formal qualification.
