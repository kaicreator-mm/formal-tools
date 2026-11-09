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

## 2026-11-09 — R3 JavaScript-first runner migration and actual pure-JS checks

- **Architecture:** ESM JavaScript core + Node.js CLI + official MCP TypeScript SDK v2 adapter; no Python CLI/MCP left in the canonical branch. Node external native calls remain optional and separately governed.
- **Actually executed in restricted ChatGPT V8 JS environment:** 1,200 seeded CNF samples compared to independent brute-force Boolean enumeration; 500 seeded graph samples compared to independent Kahn cycle detection (including cycle-witness edges); 4 direct writer/state/error cases. Result 1,704/1,704 PASS with zero mismatches. Pure core source blob SHA `509b9e6b970d54ec68469cee702bc0ae2ee33340`.
- **Experience:** differentiate formal logic proof from finite-model checking. Pure JS can check explicitly bounded and finite relationships directly without any external binary, yet cannot replace first-order theorem provers or SMT engines over unrestricted domains.
- **Remaining gates:** Node CLI integration, MCP v2 stdio handshake, 13 native tools' actual binaries, Woodpecker 3.18 workflow; all NOT_RUN. Do not promote to native-runtime PASS on the basis of pure JS.

## R3 refinement — explicit computational budget (source c717cb3b2eb4d13422fbdfb859aa3fcceee3851a)

- A bounded variable count alone does not guarantee acceptable runtime for a JS SAT checker with long clauses. Enforce a hard work budget and return `UNKNOWN/INCONCLUSIVE` on exhaustion instead of silently declaring `UNSAT`.
- Re-ran 1,704 finite model cases against revised core and one deliberate budget-exhaustion input, 1,705/1,705 checks passed in the restricted JavaScript environment.
- The saved receipt is in `validation/R3_JS_EXECUTION.json`; Node/MCP and native binary execution remain NOT_RUN.

## 2026-11-10 — R4 full CLI surface vs typed operation coverage

- **Problem:** hundreds of tool/version-specific flags cannot be accurately mirrored as a static, manually maintained cross-tool interface. Confusing CLI pass-through with complete typed wrappers produces invalid acceptance claims.
- **Resolution:** 13 official native tool families, 53 typed common operations, a **trusted-local-only raw native pass-through**, and live binary-specific `native-help`. The MCP interface can describe or plan the operation without exposing arbitrary raw execution.
- **Safety:** enforce tool/entry allowlist, reject unknown option names and types, keep `shell:false`, preserve process/solver/test/claim verdict distinctions. Disambiguate Alloy Analyzer from Grafana Alloy by requiring an explicit JAR or binary path.
- **Evidence:** pure V8 command-plan self-checks at source blob `0a4051585fe475a77d06571ffabf041ee569ce21`: 218/218 PASS. Six newly created JS source/test files parsed in a restricted JS evaluator. **Native Node CLI launch, 13 help texts, 26 actual proof fixtures, MCP handshake and Woodpecker CI remain NOT_RUN.**
- **Local repair path:** use single PR R4 and Issue #4 for the full native runtime and parser verification, do not dispatch validation-only tasks.
