# R1 Issue #7 Delivery-First execution scope (2026-11-10)

**Authority:** [Issue #7](https://github.com/kaicreator-mm/formal-tools/issues/7), as updated on 2026-11-10. This is an implementation note, not a change to historical frozen Product/roadmap records.

## Scope

R1 only delivers the maintainable technical infrastructure: 13 official formal/logic tool catalog, executable discovery, CLI/MCP/JS/TS SDK, private input workspaces, technical process result and output-artifact capture, version/OS compatibility reporting, Node/TypeScript tests and Woodpecker. Proven tool versions and unavailable engine statuses remain explicitly separate.

**The R1 exclusion is not a permanent ban on future intelligent method engineering.** LLM-assisted requirements → method selection → model generation → execution → independent verification → Tool/Method/Solution evolution belongs to a later Product/L1 + Demo + Task DAG, not to this Issue #7 release.

Responsibilities: formal-tools provides generic tool and eventual method infrastructure; domain-simulator owns domain reasoning, simulation and counterfactual models; domain-forge owns DKE/knowledge processing; domain-harness owns DIS production execution. dx-service is retired and is not folded back into R1.

## Delivery order

- **A (blocker):** PR #10 is still Draft. On exact HEAD `65ecc5d694d0618e6986836efa9a8a883912b99f`, Woodpecker #20/#21 failed after adding `npm run typecheck`. Fetch actual CI logs before identifying cause; repair in the **same PR**, run Node + checkJs + Woodpecker on the final exact SHA, perform independent review and merge. Never bypass TypeScript or inherit CI results from prior SHAs.
- **B (minimal viable infrastructure):** after A, close only genuine D06/D07/D09/D10 deficits and complete **D08** generic API and permissions parity, **D11** real CI + compatibility evidence, **D12** one *real external consumer* tool-interface smoke. Do not invent domain models, proof properties or solver recommendations.
- **C (actual native engines):** Issue #4 tracks 13 engine/version inventories and the relevant 26 positive/negative fixture runs on a real host. Only incrementally re-run affected tools. Uninstalled binary is NOT_RUN/INCONCLUSIVE rather than FAIL. This is not a source merge blocker.

## DAG interpretation after #7 revision

| Task | R1 meaning | Current evidence / gate |
|---|---|---|
| D01–D05 | Product baseline, registry, installation diagnostics, CLI and read-only MCP | PR #9 merged main `41925288dd5b777d49c4e442d9731581895cb037`; Windows Node/TS/MCP and Linux Node CI acceptance scoped to PR #9 source SHA |
| D06 | Reliable typed process invocation, private workspace, generated-artifact integrity | PR #10 source implemented, Node CI passed on earlier SHA but mandatory TS gate is red |
| D07 | Stable technical CLI/MCP/SDK accessibility and type declarations | PR #10 experimental workspace import and typed declarations; stable publication not required for R1 |
| D08 | Generic SDK/CLI/MCP capability and permission parity | `tests/tool-contract-parity.test.mjs` added as source; Node CI on current SHA pending |
| D09 | OS/tool/version compatibility catalog, exact-SHA evidence semantics | PR #10 source done; real solver availability tracked in #4 |
| D10 | Exact-SHA Woodpecker CI and quality gates | Node CI green at previous SHA, TypeScript gate currently failed at PR #10 latest known SHA |
| D11 | Real CI receipts, compatibility evidence closure | Await final source CI/TS receipts; historical evidence not upgraded across SHA |
| D12 | At least one real external consumer of generic tool API | NOT_RUN; needs actual consumer repo integration, not synthetic test or formal-tools self-test |

## Closure

R1 may be closed once the technical mainline meets Node/TS/CLI/MCP/Woodpecker on final exact SHA with P0/P1=0, the OS/tool/version source-vs-native status is machine-readable, and a real consumer successfully smoke-tests generic input → invoke → artifacts → failure/timeout behavior.

No complete 13-engine installation, full cross-OS solver verification, business proof, or future LLM method-generation release is required to close R1. Native engine expansion remains #4 or a separately scoped follow-up.

**Current authoritative progress snapshot**: D01–D05 integrated (5/12); D06/D07/D09/D10 in PR #10 and not DONE (4/12); D08/D11/D12 pending (3/12). D08 source smoke test additions do not count as delivery until Node/CI passes.
