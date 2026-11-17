# G4 product-refinement — H1 Source→Model refinement of original xDownload raw business semantics

Lane: **I11 H1 single Writer** (R93 Lane A), claim [issuecomment-6954611591] on
kaicreator-mm/formal-tools#11. Branch base: main first parent
`971253f6f41744560f784ab4e195ddaee0fe7b15`.

## What this is

An executable refinement of the **original xDownload raw business semantics**
(snapshot via merged #163, source commit `e904f08c478b15147b1c07fbe53c610d2d81851f`)
into a pure Node model, with a machine-readable POS/NEG witness and a
machine-readable record of the five frozen SMT QF_UF abstraction gaps.

| File | Content |
|---|---|
| `REFINEMENT.json` | Source→Model unit map + executable witness (every entry anchors to the original Git Blob) |
| `SMT_ABSTRACTION_GAPS.json` | The five frozen SMT cases' abstraction gaps, each with executable witness replacements |
| `model/t01-intent-model.mjs` | T01 exact-key no-widening intent grammar (opaque targetRef, output-root containment, 1 TiB bound) |
| `model/t03-effect-gate-model.mjs` | T03 1 MiB guarded effect-INTENT decision vs T01 1 TiB grammar + pure seal step |
| `model/s3-network-guard-model.mjs` | S3-only public-DNS/IP/TLS guards: CIDR classification, strict media URL grammar, per-hop TLS identity, bounded redirect loop (DNS + byte transport are REQUIRED injected seams) |
| `tests/xdownload-product-refinement.test.mjs` | Witness-driven executable POS/NEG suite (Node>=24, `node --test`) |

## What this is NOT

- **No Effect executes anywhere.** The T03 decision layer emits a declarative
  effect INTENT (plain data, `executed:false`); no permit, no capability call,
  no byte transport, no Host action.
- **Engineering-only.** No Source Owner adoption, no independent professional
  Oracle, no trust roots (`G4_QUALIFICATION_ANCHORS.json` stays
  `NOT_CONFIGURED/[]`), no Qualified Solution, no positive Replay, no Release.
- No existing SMT case / store / root / crosswalk file is modified; the #163
  snapshots are read-only inputs; the five frozen SMT cases are re-solved by
  nobody in this lane.

## Run

```sh
node --test tests/xdownload-product-refinement.test.mjs   # this lane only
node --test tests/*.test.mjs                              # full repo suite (CI form)
```

Requires Node >= 24 (no dependencies; `node:test` + `node:assert/strict`).

## Review protocol

Delivery comment binds the exact HEAD SHA + Woodpecker pipeline. Independent
review happens in a **different conversation** (Source-First), judging:
write-scope containment, witness↔source-anchor faithfulness, POS/NEG
counterexample executability, and the no-Effect / engineering-only limits.
Review acceptance grants scoped engineering review credit only — never formal
qualification.
