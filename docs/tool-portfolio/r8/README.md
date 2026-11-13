# R8: source-repaired current PR #22 native regression (no formal T4 promotion)

**OUTPUT_LABEL:** FORMAL_TOOLS_I24_TOOL_INTEGRATION_CONTINUE

Source: [portable PR #22](https://github.com/kaicreator-mm/formal-tools/pull/22) exact HEAD `7fbe3b69114d7f34b9b0296757cdca43fde07412` after R7 independent reviewer identified two P1 and two P2 on the prior HEAD `31ef3f359996ee54b346bc2c0a1c7841fe8a4ec2`. Source changes touch **only six files** (AFL++ and ELK fixture contracts; fast-check, Hypothesis and Mesa negative/error checks). Six actual source files were materialized with bytes whose Git Blob SHA1 **match six GitHub blobs** in the [R8 machine index](./EXACT_PR22_FIX_RECHECK.json). The reconstructed portable runner is byte-identical to the PR #22 runner blob `94909a645eee266549a6b17e42e5f4478d72aaee` and SHA256 `066674ca41414d1e80019218a5d20f404c0fef75785fb348fed313634720c1d3`.

## Actual Debian 13 host results, not synthetic

**Non-root uid 1000; bundle root-owned, tool directory write denied**. Reused existing SHA-verified canonical Drive original tool packages and Java/Node runtimes. Fresh isolated run **only for affected tools**, not a redundant 36-tool rebuild.

| Tool | Positive | Negative | Invalid input | Scope |
| --- | --- | --- | --- | --- |
| AFL++ 5.03c #25 | 0 / `FUZZER_EXECS` | 1 / `INVALID_INPUT_DIRECTORY` | 1 / `INVALID_ARGUMENT` | Native ELF; narrow invalid input-dir diagnostic and exit code exact 1 |
| ELK 0.6.0 #35 | 0 / `CLASSIFIED_TAXONOMY` | 1 / `PARSE_REJECTED` | 1 / `MISSING_SOURCE` | Real Java21 taxonomy produced, checked `Parent` ⊑ `Person`, reparsed, **SHA identical** |
| fast-check 4.10.2 #36 | 0 / `PASS` | 0 / `COUNTEREXAMPLE` | 1 / `INVALID_API_ARGUMENT` | Original bundled Node22; negative now rejects unrelated API errors |
| Hypothesis 6.170.15 #39 | 0 / `PROPERTY_HELD` | 0 / `COUNTEREXAMPLE` | 1 / `INVALID_STRATEGY` | Verified alternate offline wheelhouse + host CPython; not hermetic original bundled Python |
| Mesa 3.5.2 #42 | 0 / `STEPS` | 0 / `REFUTED` | 1 / `INVALID_MODEL` | Original Mesa tar + host CPython numpy/pandas; not self-contained portable |

All five Runner `formal-tools/portable-verify/0.2` TSV files have `verdict PASS` and **all 3 phases** matched the expected output *and exact exit contracts*. The source original AFL++ and ELK R7 misleading “PASS” is **not** retroactively corrected; this is a new HEAD-specific execution.

### Durable raw outputs — verified after Drive roundtrip

[Original R8 raw evidence ZIP in canonical Drive validation/receipts](https://drive.google.com/file/d/15rgRwAfH9BmZz-Xpx5u3lbg5GgR25OR_/view?usp=drivesdk), file ID `15rgRwAfH9BmZz-Xpx5u3lbg5GgR25OR_`.

- Size **12,807 bytes**; SHA256 **`dc5a72e21592c9e55bfcf9975edb9152d265e9658098da9fe57d02b798aef0e8`** before and after upload, ZIP CRC PASS, 23 entries.
- Includes individual raw native-child `verify-*.pos/neg/err.log` outputs and `verify-*.tsv` receipts, **not just derived gateway JSON**. Contains reproducibility metadata/asset hashes in `R8_NATIVE_RECEIPTS.json` inside the ZIP.
- Includes original ELK taxonomy and the re-parsed 192-byte taxonomy. Both files SHA256 `1a4b1a41ee270d06cc189376f0a6bd590a1339ebf722d95b467023814bdb8274` and contain `SubClassOf(<http://example.org/pos#Parent> <http://example.org/pos#Person>)`.
- Earlier R7 raw archive was independently restored, SHA checked and uploaded too: [R7 source-capped archive and full member hash index](../r7/RAW_RECEIPTS_INDEX.json). R7 logs are historical and cannot qualify changed R8 contracts.

### CI, independent review and Product/qualification boundary

At last check, source PR #22 HEAD has Woodpecker push **#642 FAILURE** and PR **#643 FAILURE**, **root cause unknown** until step logs are read; an issue in GitHub clone, typecheck or native tool cannot be inferred from a status alone. Do not manufacture empty commits to force green. An independent *non-Writer* Source-First reviewer must evaluate current exact source and compare to the previously reported R7 P1 defects; an older review is not automatically valid at the new SHA.

This checks the **real portable Runner plus individual tool cases**, not the full original project CLI/MCP/SDK runtime in this host. The historical merged #69 T4 JS gateway tests/CI remain separately bounded. One successful Runner output is `FIXTURE_TECHNICAL_PASS_UNREVIEWED`, not independently approved T4, not Source/Oracle/Solution Product #11, and never semantic T5. Hypothesis/Mesa host Python variants are not hermetic runtime admission. ELK negative is explicitly **malformed-ontology parser rejection**, not ontology semantic inconsistency.

**New candidate formal T4 qualified: 0/23. T5: 0/36.** #7 and #14 unchanged.
