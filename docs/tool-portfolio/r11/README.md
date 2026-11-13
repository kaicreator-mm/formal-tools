# #24 / R11 — exact nuXmv 2.2.0 CTL and private-library admission evidence

This PR is a **one-tool fixture** repair; the shared Runtime `doctor` implementation belongs to [PR #79](https://github.com/kaicreator-mm/formal-tools/pull/79) with a separate Writer/read-set and same tool metadata contract. No SDK/MCP/Registry source is changed and no extra MCP server is created.

Original Drive `nuxmv-2.2.0-linux-x86_64.tar.zst` SHA256 `75ef7e5c33a68849e84dc8e7ac784b8aee62d6e8c7ffe20ebda8c4b0797df41b` matches canonical manifest; 39 safe archive entries, genuine `nuXmv 2.2.0` binary with its own `libicuuc.so.70`. Host is Debian13 x86_64 **nonroot nobody** with original source bundle read-only.

The actual corrected PR79 portable Runner source Git Blob `0f9e1f7d5f07c3dafaaba59cc08a0beaff944a99` was used **in an isolated staging environment** with original `meta.sh` identity alias `TOOL_TOOL_ID` normalized only in the disposable staging tree. The old delivered tool archive is unchanged and NOT formally package-qualified until rebuilt and re-pinned.

| Fixed source fixture | Actual native exit | Exact process-owned output |
| --- | ---: | --- |
| POS `tests/nuxmv/pos.smv` | 0 | `-- specification EF s = 7  is true` |
| NEG `tests/nuxmv/neg.smv` | 0 | `-- specification AG s <= 5  is false` |
| ERR `tests/nuxmv/err.smv` | 1 | `line 2: at token "is": syntax error` |

Original source `expect.sh` matched `is true`, `is false` and allowed **any** error exit with a generic error regex. Strict new fixture (Git Blob `24e670e3420afa61c800396d5b5154b8bd1a3898`) anchors the real CTL formula and observed Boolean result, and pins syntax error to process exit **1**. It was **executed byte-for-byte** with exact native `formal-tools/portable-verify/0.2` TSV sha256 `6ffe9ad5b962f0231cc2272f4714e9f3b31ead22ce90ae3a65a1e508bc31eae7`; POS/NEG/ERR all matched with exact exit contract, runner exit0.

**Reproducible real shared doctor bug:** old `ldd` without private `LD_LIBRARY_PATH` reports `libicuuc.so.70 => not found` although the original run wrapper exports `tools/nuxmv/lib`. The PR79 updated Runner sets the exact private library path for `ldd` and **this actual nuXmv doctor now exits 0** with `verdict: OK`. Direct ldd with the bundled path finds no missing lib. PR79 independent mocked-lib doctor tests are **6/6 PASS**, including a truly absent library case remaining FAIL. The two PRs do not overlap file writes.

[Canonical Drive R11 raw process logs, TSV, fixture, source runner, metadata and ldd comparison](https://drive.google.com/file/d/18JllviN3GF86ocNhLIkCy8k9NUmaeyQA/view?usp=drivesdk), ZIP **11,309 B**, SHA256 **`661fccef52e9fbf39c76f6e3c3940cfda69b65dc8ab2efdef884937cad86d0d6`** (verified after Drive readback, 18 entries, CRC PASS). [Machine-readable exact SHA index](./NUXMV_NATIVE.json).

**Honest gate:** scoped native T3/fixture-level technical PASS; **not** original-repackaged T4, not full main CLI/MCP/SDK host end-to-end, not independent T5 model semantics or Product #11. The source Runner PR79 is currently separate/unmerged at time of recording. Require both exact-HEAD Woodpecker push+PR CI and independent non-Writer Source-First review before merges; avoid repeating unaffected historical tool tests. #7/#14 stay closed.
