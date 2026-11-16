# G4 xDownload source → frozen SMT abstraction: bounded mapping and falsification R1

**Scope:** engineering-only differential readback for formal-tools #11, following independent semantic audit comment #6928498164 (P1-01 source/model mapping and P1-02 independent professional authority). Original five SMT files and two native dual-solver packs are untouched. This is **not** a proof of JavaScript-to-SMT equivalence, professional Oracle admission, or Qualified Solution/positive Replay.

## Frozen origin and admissible input boundary

- Source `kaicreator-mm/domain-harness@b3a962c673f2e623ccd3db8ba059c4bae456b9dd` `examples/dis-v020-interaction/download-goal.mjs`, Git Blob `f57747aa7996c88833e72288a0acd594a7ce5468`; SHA-256 `aa7dc083fd0a7dc6f9d98e0792058d567b16c1b4883f9fe9d80fa91733afe4c2`. A byte-identical snapshot is kept under `benchmarks/llm-methods/g4/semantic/source/` solely for offline source differential verification; do not edit the original domain-harness source.
- Model Set `f2d38a858cc89e03d2deecc332dc2b120c632f02`, SHA-256 `ccffedd71e77e85faea3a98aee7e8b9a0bb3242d3b5e7fbf4103a974b571c7f2`. All five original SMT blobs and their historical SAT/UNSAT outputs remain unchanged; `MAPPING.json` pairs exact case/Blob identities and declares assumptions/exclusions.
- The bounded positive interpretation applies to the **selected DIS Function ABI's validated ordinary own-data DTO only**, not arbitrary Proxy, getter, non-enumerable or hostile direct JS calls. No claim is made for the Host/signed preflight/Effect layer from the SMT cases alone.

## Five case-by-case source→SMT correspondences

| Frozen case | Solver result | What directly maps to the pinned JS | What it does **not** establish |
|---|---|---|---|
| Valid inspect/confirm | SAT | Complete valid DTO: `AWAITING_CONFIRMATION` then `READY_FOR_KDP` after explicit confirmation | No source/model bisimulation, historical inspect session or Host authorization |
| Not confirmed | UNSAT | A valid rechecked proposal with `confirmed !== true` stays `AWAITING_CONFIRMATION` | All malformed runtime inputs, temporal lifetime |
| Invalid supplied input | UNSAT | Invalid channel/ID/URL/byte size cannot produce `READY_FOR_KDP` | The distinction between `REJECTED`, `CLARIFICATION_REQUIRED`, normalization and thrown getters |
| Undeclared answer / forged status | UNSAT | Disallowed answer keys make `answers_allowed=false`, independently blocking READY | `injected_draft_ready` is **non-causal** in the original SMT equation. In JS a valid fabricated draft with `status:'READY_FOR_KDP'` **can** reach READY after full revalidation, even without an earlier inspect call. Therefore no prior-inspect invariant is claimed |
| No effect | UNSAT | Selected pure `inspect`/`confirm` outputs carry `authority=NONE` and `effectDispatched=false`; READY carries `permittedEffect=false` | SMT asserts both effect values false as **axioms** and then contradicts them. This is *not* an independent universal proof of no effects in arbitrary JS/Host/KDP execution |

## Executable falsification boundary

`tests/xdownload-source-model-differential.test.mjs` reads the original source snapshot's exact Git Blob/SHA-256 and all five SMT Blob identities. It then exercises actual exported source functions using selected trustworthy DTOs and counterexamples: full positive, confirmation false or nonboolean, absent fields, invalid channel/ID, HTTPS rules, token query, hash/userinfo, URL canonicalization, `declaredBytes` 0/1/1,048,576/1,048,577, undeclared answers, forged draft status, valid draft without prior inspect, non-enumerable field and exception-producing getter. The last two are deliberately **outside** the trusted DTO model and demonstrate why model claims cannot be generalized to all JS objects.

The source may throw for a hostile accessor rather than return `UNKNOWN`. `UNKNOWN`, `STALE` and `INVALIDATED` belong to the separate DIS consumer/G4 store layers, whose existing exact-head tests remain the evidence. A `READY_FOR_KDP` observation requires a separate selected KDP Intent call for any Effect; this test never makes that call.

## Qualification and next independent review

- P1-01 is narrowed to a field/branch mapping with falsifiable positive and negative examples. **Semantic equivalence remains unproven**, and an independently admitted source-to-model translation / counterexample-completeness review is still required to claim more than a bounded sampled mapping.
- P1-02 is **still BLOCKED**: actual Oracle is the source-authored v0.1 cross-check. No original Product-approved Source Owner, separate professional semantic Oracle, or trusted Host source/signing roots have been introduced. The 3-role witness crypto tests are not authorization.
- Preserve `BYTES_BOUND_UNATTESTED`, `NOT_ADMITTED`, `UNVERIFIED`, `G4_QUALIFICATION_ANCHORS.json=NOT_CONFIGURED`, `REPLAY_BLOCKED_UNQUALIFIED`, `authority=NONE`, `effectDispatched=false`; no acceptance of positive Replay or Product/Release.
- Separate conversation reviewer must verify exact source/SMT Git Blobs, mapping assumptions, each hostile counterexample, and focused CI on the final Exact SHA. No native solver or DeepSeek rerun.
