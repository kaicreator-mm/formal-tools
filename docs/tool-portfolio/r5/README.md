# #24 R5: ChatGPT Debian 13 native execution checkpoint (scoped evidence)

## Why this exists
This is a real **in-container** execution checkpoint, not a prompt for another local agent. Public GitHub source remains authoritative for interface contracts; canonical original portable tools were fetched directly from the owner's Google Drive software vault through its authenticated connector. No network inside the container; no Docker engine; 30 GiB free disk, ~5.8 GiB RAM, Node 22.16.0, CPython 3.13.5, original Temurin Java 21.0.13+9 from Drive. Actual reruns used UID **1000** with tool bundle **not writable** to that user. Never use this as proof of Docker network isolation.

Machine-readable [source/sha/process/phase/receipt table](./CHATGPT_DEBIAN13_EXECUTION.json) covers six attempted tools and the new Why3 archive.

### Corrected runner identity, without editing PR #22
Original Drive portable-core tar.zst hash `fe9699e…` was verified against canonical `SHA256SUMS`, but its bundled runner was older (`d232a39e…`, no `runner_schema 0.2` marker). In a disposable extracted **staging** bundle, applied the exact source diff against PR #22 HEAD `3aa35b8c82545d8b234ae81f778b474173bff0d9`, independently checking the modified tool-runner's Git blob SHA `94909a645eee266549a6b17e42e5f4478d72aaee` and actual SHA256 `066674ca41414d1e80019218a5d20f404c0fef75785fb348fed313634720c1d3`. This preserves original downloaded bytes and binds technical execution to a specific corrected runner, but it is **not** a newly repackaged full PR #22 portable bundle.

### Real tool execution (non-root)

| Tool / Issue | Runner `0.2` phase evidence | Verdict and limit |
| --- | --- | --- |
| CBMC 6.11.0 #30 | pos 0 VERIFIED; neg 10 VIOLATION; err 3 ERROR | 3-phase technical fixture PASS, still **not independent T4 PASS** |
| ELK 0.6.0 #35 | pos 0 CLASSIFIED; neg 1 PARSE_REJECTED | 2-phase PASS; missing `err` so full T4 **not qualified** |
| AFL++ 5.03c #25 | pos 0 FUZZER_EXECS; neg 1 ERROR | 2-phase PASS; missing distinct `err` |
| fast-check 4.10.2 #36 | pos 0 PASS; neg 0 COUNTEREXAMPLE | 2-phase PASS; missing distinct `err` |
| SimPy 4.1.2 #52 | pos 0 SIMULATED; neg 0 REFUTED | 2-phase PASS **host Python fallback only**; missing `err`, non-self-contained |
| Tree-sitter 0.27.2 #57 | CLI `--version` works; Python fixture pos/neg rc=1 | FAIL: `ModuleNotFoundError: tree_sitter`, not native fixture PASS |

All cases observed the *actual* `runner_schema formal-tools/portable-verify/0.2` line. Five fixtures' `verdict PASS` means **their authored fixture contract passed**; it does **not** mean three mandatory T4 phases were present. This is a critical false-promotion boundary. Each receipt's SHA256 and phase exits are in the JSON.

### Dependency and security blockers found by execution
1. The standalone **294,346,075 B** original Python 3.13 runtime cannot be downloaded through the current Google Drive connector: HTTP 413 at 268,435,456 B. For SimPy only, the tool used a clearly marked Debian13 host CPython 3.13 compatibility shim. Do not count this as a relocated, offline self-contained runtime.
2. The re-uploaded **Why3 1.8.0** archive was downloaded completely (41,550,468 B), **zstd PASS**, sha256 `5343afcbccd2805dbf9c1ff7689371ced7857a42d0f57615d22e9bee701ff8f3`, but differs from existing canonical `SHA256SUMS` pin `6a0e3cc7…`. Safe tar preflight: **5,346 entries, 315 symlinks, 27 absolute symlinks** to host paths (e.g. `/etc/environment`, `/dev/null`). **Fail closed; never extracted.** Original signed/source provenance and hermetic repackage remain #59 owner tasks.
3. Original Tree-sitter CLI does not supply the pinned Python `tree_sitter` binding used by the committed `expect.sh`; do not infer a correct Python fixture from the CLI-only smoke.
4. This transient container did not fetch/check out the entire `main` JS monorepo. **No native execution of the merged T4 JS CLI/MCP/SDK gateway in this container is claimed.** The source integration has its own independent review, Woodpecker exact-SHA #520/#521 SUCCESS and earlier Debian13 MiniZinc gateway receipt.

### Action
The general statement “needs local environment” is overbroad: this environment really can test many tools using the owner's Drive assets. Continue the next tool sample here where source and bundle can fit connector limits, restore missing fixture `err` cases via PR #22 original Writer (not in this docs PR), and require independent source-first review before promoting T4. If an archive is too large or insecure, preserve `BLOCK` with a precise reason. #7/#14 stay closed.

**Qualification summary:** 36 registered, 13 native interfaces, 23 candidate bounded routes already merged in #69; 5 scoped real runner observations here, **1 complete three-phase technical receipt**, **0 new fully independent T4 qualified**, **0 T5**. Historical 19/36 original tar and 34/36 with alternates remain scope-limited and are not overwritten.
