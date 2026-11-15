# G3 — Drive package byte-provenance reconciliation (2026-11-15)

## Result

**Byte identity reconciled for the exact original Z3 5.4.0 and cvc5 1.4.2 packages used by the existing G3 Native receipt.**

The exact original `App/10-formal-tools/portable/tools` archives were downloaded from Google Drive as raw bytes, hashed locally, checked against the same Drive `SHA256SUMS` manifest, tested with `zstd -t`, listed before extraction, and only then selectively extracted. The executable SHA256 values and version probes match the original `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` pins.

This is a byte-provenance reconciliation, **not a new solver run** and not a promotion to trusted tool, Host, Oracle, Solution or Replay qualification.

## Exact artifact chain

Drive location:
- Portable root: `App/10-formal-tools/portable` folder ID `1DsQtN4Ei3F8YGyDxUGiXCWNuIU8mS2wp` (Drive metadata: folder name `portable`, parent `10-formal-tools`, grandparent `App`)
- `tools/` folder ID `1rIJ315fjiXtJEPk9mjXP2Kzty4V3n3nZ`
- `SHA256SUMS` file ID `1wdSCQAJ6eW_J7szGNeYTnkmRHxtWusI1`
- Manifest SHA256: `671bd9891a35d1e572f024f7587a50ce171f7cab5dbd2cb9a3acf00bc4da9f64`

| Tool | Exact Drive archive | Archive SHA256 | Executable SHA256 | Result |
|---|---|---|---|---|
| Z3 5.4.0 | `z3-5.4.0-linux-x86_64.tar.zst` | `039d3f8c75e92ceb196bb1291d8602340541f1b1be2f0a1acf32d3c025f8ed16` | `e9d7e6e6d76c81b5ea3f06d165fc4cfd8afab92b74cdf94417380b5eed10845d` | Manifest + Native receipt archive and executable digests match |
| cvc5 1.4.2 | `cvc5-1.4.2-linux-x86_64.tar.zst` | `b7a5f6d1740086347d8055dab7fd1216960e19ab7a769fa2b15c1ec76ed0c193` | `6aecddf466552b83bb5883756c7955e0c9d5ddcc6d7f45b48c2f6e06a741b102` | Manifest + Native receipt archive and executable digests match |

Both archives:
- `zstd -t` exit 0.
- `tar --zstd -tf` exit 0; exactly six members each.
- No absolute paths, parent traversal, or symlink members.
- Only extracted after the member review.
- Exact binary `--version` probes exit 0 with empty stderr.
- No SAT/UNSAT solve case was run in this reconciliation.

Z3 version output is byte-identical to the pinned version-output digest in NATIVE_PAIR (`9af7c6f186418585f022fd2d18eb2d278e14ad21731bf3339f3cbd1f78500e7a`). cvc5 reports `1.4.2 [git 282d5e0]`; NATIVE_PAIR does not carry a cvc5 version-output digest, so none is inferred.

## Source/model/oracle bindings

The following three source Git Blob pins are embedded in NATIVE_PAIR and match the exact current-main source files:
- Frozen fixture `benchmarks/llm-methods/r0/spec-fidelity-cases.json`: Git Blob `33952ec8f460f022e750f91543c7dafbae35c9e2`.
- Native matrix generator `benchmarks/llm-methods/g3/ads-native-matrix.mjs`: Git Blob `ce3a2dc2dde0ce7805c610e1caf4dfa524904e2e`.
- Frozen replay driver `benchmarks/llm-methods/g3/ads-native-replay.mjs`: Git Blob `9794ec4b62d3f5e9c22fa1f45ee3999565aa9a68`.

The following are supplemental Git identities recorded by this reconciliation, not source pins embedded in NATIVE_PAIR:
- NATIVE_PAIR receipt itself: Git Blob `cee8f188cce20b042df505f824cccae64d2c9b1c`. This identifies the receipt object externally; a Git object cannot embed its own final Blob ID.
- Independent finite verifier source `benchmarks/llm-methods/g3/independent-finite-verifier.mjs`: Git Blob `2213cf7f3025a32923625e9276d5dc42c7c1db42`. This is a supplemental current-main source identity recorded in RECONCILIATION.json and is not a field in NATIVE_PAIR.

The fixture itself explicitly states `SOURCE_AUTHORED_NOT_INDEPENDENTLY_AUDITED`. Hash binding proves which bytes were used; it does not establish professional semantic truth. The G4 candidate's model/oracle content digests remain engineering provenance values only.

## Important alternate-package trap

Drive also contains similarly named ZIP packages:
- Z3 `z3-5.4.0-x64-glibc-2.39.zip`: archive SHA differs from NATIVE_PAIR, although its contained Z3 executable SHA happens to match.
- cvc5 `cvc5-Linux-x86_64-libcxx-static.zip`: archive SHA and executable SHA both differ from NATIVE_PAIR, despite the same 1.4.2 version label.

Those ZIPs were **not** used for reconciliation. The exact original `.tar.zst` files under `App/10-formal-tools/portable/tools` are the receipt-matching artifacts. Do not substitute packages by version label alone.

## Environment and limits

Local inspection environment: Debian 13.3, Linux 6.18.57 x86_64, glibc 2.41, Python 3.13.5, Node 22.16.0, UID/GID 1000. The version probes ran in this current container. They did not reproduce the original UID 65534 Native solve execution, and they do not attest the original Host.

This closes the **archive/executable byte-identity** gap for the two recorded binaries. It does not verify vendor signatures or upstream release attestations, and does not independently attest the process/Host. No new solver cases, no Z3/cvc5 24×2 rerun, no changes to historical receipts, and no Product/Oracle/Host/Qualified Solution/Replay/Effect promotion.

See machine-readable evidence in `RECONCILIATION.json`.
