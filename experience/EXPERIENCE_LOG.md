# Formal Methods Experience Log (append-only)

No executable validations are claimed by this initial skill bundle. For each future project test append a record:

## Template

- Date UTC / project / Issue / PR / exact Git HEAD:
- Claim and formalization scope:
- Skill name, version, source revision:
- Runtime evidence (command, exit code, input SHA, model/output SHA):
- Positive case result:
- Mutation/negative case result:
- Unexpected counterexample / false-positive risk:
- Required fix (encoding, workflow, tool, source spec):
- Revalidation receipt and promotion gate:
- Reusable lesson, with limitations:

Do not overwrite failure history on successful reruns. Link back to authoritative Git issues and validation receipts, never copy private data into a public repository.

## 2026-11-09 — R1 Skill self-audit (static only)

- **Origin:** GitHub `kaicreator-mm/formal-tools-skill` PR #2, exact audited source HEAD `2df9e94e516caaaa4b261ae0ae4175ef19aa6983`.
- **Finding:** Source R0 contained a serious Skill discovery incompatibility: 13 YAML names used `formal-*` while folder names lacked prefix; corrected to exact folder names.
- **Finding:** Alloy sample used a property already false in its supposed positive baseline; add a bounded acyclicity fact for the positive case. Soufflé lacked a cycle-detection rule for its negative case. Jena, pySHACL and Apalache required complete input fixtures; incomplete doctor commands were corrected.
- **Fix:** 29 versioned example inputs, 13 positive/negative acceptance descriptions, repaired skill instructions and packaging rules. Distinguish independent installers from the six-tool toolkit.
- **Static evaluation:** 74/74 structural checks, 14/14 frontmatter checks, 13/13 fixture mutation-shape checks. The checks do **not** prove parser or solver correctness.
- **Runtime gate:** `NOT_RUN`, container command execution returned `ClientError`; no solver outputs, no Plugin install and no cross-conversation discovery evidence.
- **Lesson:** Skill generation must be followed by a name/path contract check and executable fixture pair readback before requesting runtime validation. Never confuse source audit with proof.

## 2026-11-09 — R2 shared CLI/MCP/Woodpecker design (source-only)

- The 13 tool wrappers should share one allowlisted subprocess core, not 13 separately evolving MCP servers.
- Woodpecker Agent is a CI worker: integrate formal checks as Docker Pipeline Steps first, then a reusable Plugin; do not patch the core Agent binary.
- Document every tool's theoretical basis, architecture, implementation and quick start, including separate Python/Java/.NET dependency needs.
- Distinguish fixture test PASS, underlying tool result, and project Claim verdict.
- Pending: run unit tests, parser/CLI/version checks, native positive/negative fixtures, MCP Inspector connection and Woodpecker 3.18 CI receipts. All remain NOT_RUN at time of authoring.
