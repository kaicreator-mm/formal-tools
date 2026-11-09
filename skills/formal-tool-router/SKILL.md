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

Choose the matching `skills/<name>/SKILL.md`. Start with a minimal reproducible executable case, then the actual invariant, then a negative mutation. Preserve Git SHA, tool version and model checksum. If environment execution is unavailable, output `NOT_RUN` and an exact reproduction command without claiming a proof. Avoid spawning all tools for every claim; use only independent checks that change confidence or coverage.

## Assurance limits

A SAT model is a witness of satisfiability, UNSAT is relative to encoded axioms/theory, bounded search is not universal proof, and a Lean kernel-checked term proves only its formalized theorem. Natural-language specifications require independent semantic review of the encoding.
