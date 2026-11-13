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

## Raw receipt durability — still blocked

The earlier record declared `formal-tools-i24-r7-exact-pr22-native.zip` SHA256:

`d14e288853b9607aeb7bb0062a0984b68d5d2fa8a41cc3c2955c9e3c90ed7682`

A matching-named 15,753-byte artifact exists in the ChatGPT Library at `/fm-tools/formal-tools-i24-r7-exact-pr22-native.zip`, but its raw bytes are not retrievable from the current execution context and no stable external archive URL is available. The declared SHA256 has therefore **not** been reverified here. The archive has **not** been represented as Git-versioned.

Required to close this item: provide the original ZIP bytes in the current task context or place them in the canonical Drive `validation/receipts` folder. Verify SHA256, extract the original per-case receipts/stdout/stderr, then commit those exact bytes under `docs/tool-portfolio/r7/raw-receipts/`. Missing output must not be reconstructed or invented.

## CI and qualification boundary

- This evidence-only PR requires fresh exact-HEAD Woodpecker push and PR checks after the repair commit.
- Current R7 scope: six assertion-complete fixture observations, two assertion-incomplete observations.
- New independently qualified Native T4: `0`.
- New semantic T5: `0`.
- Full original MCP/SDK/CLI E2E: `false`.
- Product/Oracle/Release qualification is not claimed.

#7 and #14 remain untouched.
