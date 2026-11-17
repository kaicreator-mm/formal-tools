# G4-P2 s3-io-qualification-boundary — what the S3-lane pure guard model does NOT qualify

Lane: **FORMAL_TOOLS_I11_G4_P2** single Writer, claim
[issuecomment-6960825898] on kaicreator-mm/formal-tools#11. Branch
`task/i11-g4-p2-lte-s3-io-bound-20261118`, base main
`401f3bb55f5095fb1f131f176b2ea157e3caa212`. Addresses **P2-2** of independent
review
[#5945831322](https://github.com/kaicreator-mm/formal-tools/pull/166#pullrequestreview-5945831322)
(ACCEPT_SCOPED on merged #166): *"S3 DNS/byte transport are injected seams
and do not prove real Host TLS/timeout/body invariants"*.

## What this is

A machine-readable qualification boundary over the merged #166
`model/s3-network-guard-model.mjs`, plus executable boundary tests that
either ASSERT the model-enforced logic or DEMONSTRATE the delegation —
every aspect is bound to at least one test.

| File | Content |
|---|---|
| `QUALIFICATION_BOUNDARY.json` | 9 aspects: `ENFORCED` (QB-01 URL grammar, QB-02 redirect policy, QB-03 config validation, QB-08 network-free structure, QB-09 seam-failure mapping) vs `DELEGATED_TO_SEAM`/`HOST_OBLIGATION` (QB-04 DNS classification, QB-05 TLS peer identity, QB-06 byte transport/bounds, QB-07 deadline enforcement) — each with source anchors and test bindings |
| `tests/xdownload-s3-io-qualification-boundary.test.mjs` | the W-QB-* boundary suite |

## The boundary in one paragraph

The pure model enforces URL grammar, redirect admission/echo/cycle/bound,
reader-bounds CONFIG validation, seam-injection enforcement (no reader can
be constructed without both seams — no default network path exists) and
seam-failure mapping (`DNS_REJECTED`, verbatim failure passthrough). It does
NOT classify the IP the seam returns (a seam answering `10.0.0.1` is hopped
verbatim — demonstrated), never sees or checks a socket (`tlsPeerOkay` is an
exported HOST-side spec, never invoked by the loop), returns the hop body
verbatim without measuring it (an oversized body from a shape-compliant
reply is accepted — demonstrated), and imposes no interrupt of its own (a
deadline-ignoring seam completes — demonstrated). Real DNS, TLS, timeout and
body invariants therefore require a separately authorized trusted Host lane;
**this boundary evidence qualifies none of them** and
`G4_QUALIFICATION` stays `NOT_ADMITTED`.

## What this is NOT

- **No network I/O anywhere** — zero sockets in the suite; the structural
  test additionally proves the model source imports only
  `node:dns/promises` + `node:perf_hooks`, references `resolve4` solely
  inside the never-tested `resolvePublicViaDns` parity shim, and contains no
  `node:net`/`node:tls`/`node:http*`/`node:stream`/`node:fs` surface.
- **No duplication of #166** — unit-level POS/NEG semantics of
  `mediaUrl`/`publicIpv4`/`classifyDnsAnswers`/`tlsPeerOkay`/
  `validateReaderBounds`/reader-loop redirects live in the #166 witness
  (`REFINEMENT.json`, W-S3-*) and are cited as `existingWitness`, not re-run.
- **Engineering-only.** No Source Owner, no independent professional
  Oracle, no trust roots, no Qualified Solution, no positive Replay, no
  Effect. The #166 model file is imported read-only; this lane adds no
  model change.

## Run

```sh
node --test tests/xdownload-s3-io-qualification-boundary.test.mjs   # this lane only
node --test tests/*.test.mjs                                        # full repo suite (CI form)
```

Requires Node >= 24. No dependencies.

## Review protocol

Delivery comment binds exact HEAD SHA + Woodpecker pipelines. Independent
Source-First review (different conversation) judges: write-scope
containment, boundary-facet faithfulness vs the model source, the
delegation demonstrations, and the engineering-only limits. Review
acceptance grants scoped engineering credit only — never formal
qualification.
