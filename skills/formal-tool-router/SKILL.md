---
name: formal-tool-router
description: Route ADS, DIS, DKE or software specification claims to Lean, Z3/cvc5, TLA+/TLC, Apalache, Alloy, Soufflé, pySHACL, Vampire, Clingo, Jena, ProB, or Dafny; require executable evidence and track counterexamples and proof scope.
---
# Formal Verification Tool Router

Read `references/VERIFICATION_PROTOCOL.md` first. Select the tool by *claim and model semantics*, not by tool popularity.

| Claim | Primary | Cross-check / escalation |
|---|---|---|
| SMT constraints, algebraic consistency | Z3 | cvc5; Lean for universal theorem |
| Recursive relation, dependency closure | Soufflé | Alloy for finite graph counterexample |
| Non-monotonic choice, mutual exclusion | Clingo | Z3 encoding if suitable |
| Relation cardinality and DAG structure | Alloy | Soufflé / Z3 |
| Concurrent transitions, safety and liveness | TLA+/TLC | Apalache bounded-symbolic; Lean for proof |
| B/Event-B refinement | ProB | TLC if translated and justified |
| RDF shape and schema | pySHACL | Jena SPARQL and entailment |
| RDF consumption, inference | Apache Jena | SHACL for integrity validation |
| First-order entailment | Vampire | Lean explicit theorem or SMT under shared assumptions |
| Program contract and implementation proof | Dafny | Lean as needed |

Read the peer Skill at `../<name>/SKILL.md` from this router directory (for example `../z3/SKILL.md`). Start with a minimal reproducible executable case, then the actual invariant, then a negative mutation. Preserve Git SHA, tool version and model checksum. If environment execution is unavailable, output `NOT_RUN` and an exact reproduction command without claiming a proof. Avoid spawning all tools for every claim; use only independent checks that change confidence or coverage.

## Runner access and execution-gate decision

For committed demos, the repo provides node packages/runner/js/cli.mjs list / validate / run, and an optional SDK v2 MCP stdio server with list_formal_tools, inspect_formal_tool, run_formal_fixture. Select only the relevant engine(s); do not run every solver by default. The MCP server requires separate host connection and does not itself install a binary.

When a project-level claim lacks a curated model, prepare the model and request a separate governed execution path; the R2 adapter deliberately does not expose arbitrary commands or model uploads. See docs/CLI_MCP_CONTRACT.md and docs/WOODPECKER_AGENT_INTEGRATION.md in Git.

**Source-only implementation:** actual subprocess, Docker, Woodpecker and MCP runtime status is NOT_RUN. Never mark a proof receipt PASS on the strength of documentation or a local CLI string.

## Assurance limits

A SAT model is a witness of satisfiability, UNSAT is relative to encoded axioms/theory, bounded search is not universal proof, and a Lean kernel-checked term proves only its formalized theorem. Natural-language specifications require independent semantic review of the encoding.

**Pure JS core:** `packages/core/src/finite.mjs` is independently executable in a restricted JS evaluator. Use it first for exact finite DAG/write-set/CNF/state problems; native proof engines remain separate. MCP is Node.js ESM on the official TypeScript SDK v2.
