# #24 R7 — exact PR #22 native evidence index (corrected)

**OUTPUT_LABEL:** `FORMAL_TOOLS_I24_R7_EVIDENCE_REPAIR`

## Frozen source identity

- PR #22 exact source HEAD: `31ef3f359996ee54b346bc2c0a1c7841fe8a4ec2`
- PR #77 reviewed evidence HEAD: `75045734b92beaec6746d5d1abdb7688e2ccd3c6`
- Runner Git Blob: `94909a645eee266549a6b17e42e5f4478d72aaee`
- Gateway Git Blob: `615b55bb0f2b5fd1e611865e1dc4c766f89d5ffe`
- 14/14 fixture/source Git Blob pins were verified in the prior R7 review.
- This PR changes evidence/docs only. No `portable/**`, Runner, Gateway, Registry, CLI, SDK, MCP or fixture source is modified.

## Corrected fixture assertion status

| Tool | Recorded process exits (pos/neg/err) | Corrected status | Reason |
|---|---:|---|---|
| AFL++ #25 | 0/1/1 | `EXECUTION_OBSERVED_ASSERTION_INCOMPLETE` | NEG accepts wildcard exit and generic banner; ERR matcher accepts generic AFL banner |
| ELK #35 | 0/1/1 | `EXECUTION_OBSERVED_ASSERTION_INCOMPLETE` | POS matches runner-generated marker without taxonomy assertion; NEG is malformed-input parser rejection, not semantic inconsistency |
| fast-check #36 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Retained bounded observation; no T4/T5 qualification |
| Hypothesis #39 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Host/alternate wheelhouse runtime, not hermetic portable runtime |
| Mesa #42 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Host Python site dependencies |
| SimPy #52 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Host CPython runtime |
| NetworkX #44 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Host CPython runtime |
| SymPy #55 | 0/0/1 | `FIXTURE_TECHNICAL_PASS_UNREVIEWED` | Host CPython + mpmath path |

The eight actual process observations and their previously recorded exit codes remain historical observations. **Only six have assertion-complete three-phase fixture evidence after this review; AFL++ and ELK are not counted as fixture technical PASS.** This does not promote any tool to independent T4 or semantic T5.

Machine-readable source of truth: [`EXACT_PR22_NATIVE.json`](./EXACT_PR22_NATIVE.json).

## Raw receipt durability — stable Drive archive SHA verified

The original **15,753-byte** archive `formal-tools-i24-r7-exact-pr22-native.zip` has now been retrieved from the current container (not reconstructed from index data), uploaded to the canonical Drive **App/10-formal-tools/validation/receipts**, then **read back** and checked again byte-for-byte.

- [Authenticated, stable Drive raw receipt ZIP](https://drive.google.com/file/d/1-Kqdc_kff6DpBOWAN65nnR3cTiPp-NVc/view?usp=drivesdk) (file ID `1-Kqdc_kff6DpBOWAN65nnR3cTiPp-NVc`).
- Archive SHA256: `d14e288853b9607aeb7bb0062a0984b68d5d2fa8a41cc3c2955c9e3c90ed7682`, **MATCH** before and after upload.
- ZIP CRC test: PASS; 19 entries, including `SUMMARY.json`, eight Gateway stdout logs, eight empty Gateway stderr files, one initial failed SymPy stdout, and the exact-head Python replay driver. [Per-entry SHA256 and byte index](./RAW_RECEIPTS_INDEX.json).
- **Scope:** These are the original **Gateway-level** stdout/stderr and summary, *not* the temporary underlying per-phase native child stdout/stderr files (those were removed by the Runner temp-workdir cleanup). Do not claim native child logs were preserved. The original tool exit codes, phase labels, receipt hashes and the preceding incomplete matcher issues are recorded, not fixed retroactively.
- **Freshness:** this archive is bound to the historical source `31ef3f359996ee54b346bc2c0a1c7841fe8a4ec2`. The live source PR #22 has since advanced to `7fbe3b69114d7f34b9b0296757cdca43fde07412` with ELK/AFL/negative-script repairs; those changed assertions **require distinct new-head technical evidence and independent review**. The ZIP cannot be re-labeled as evidence for the later source head.

This closes the former P2 *raw archive inaccessible* issue by providing a stable pinned archive, without inventing missing underlying child logs or upgrading the two incomplete original assertions.

## CI and qualification boundary

- This evidence-only PR requires fresh exact-HEAD Woodpecker push and PR checks after the repair commit.
- Current R7 scope: six assertion-complete fixture observations, two assertion-incomplete observations.
- New independently qualified Native T4: `0`.
- New semantic T5: `0`.
- Full original MCP/SDK/CLI E2E: `false`.
- Product/Oracle/Release qualification is not claimed.

#7 and #14 remain untouched.
