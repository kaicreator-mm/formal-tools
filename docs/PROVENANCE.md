# Source and maturity ledger

The following are upstream references or patterns; their existence was inspected online in November 2026. **No third-party skill was executed, dependency-audited or certified by this delivery.** This is an original adaptation with source citations, not a verbatim copy.

- Z3: upstream official Agent Skills catalogue: https://github.com/Z3Prover/z3/blob/master/.github/skills/README.md (solve/prove/encode/simplify/optimize/explain).
- Lean: upstream leanprover Lean Beam skill: https://github.com/leanprover/lean-beam/blob/main/skills/lean-beam/SKILL.md ; only use the beam-specific instructions if beam itself installed.
- TLA+ TLC: https://github.com/younes-io/agent-skills/blob/main/skills/tla-check/SKILL.md ; examples explicitly described as exploratory, not production-hardened.
- TLA+ and Lean workflows: https://github.com/opum-ai/proof-skills (community reference, not official formal authority).
- General Skill format: https://github.com/anthropics/skills and https://agentskills.io/ ; agent client decides whether the skills are discoverable.
- cvc5 docs: https://cvc5.github.io/docs/latest/ ; Vampire: https://github.com/vprover/vampire ; Clingo: https://potassco.org/clingo/ ; Jena: https://jena.apache.org/documentation/ .
- All other skill pages: the per-tool `source` link in `SKILL_REGISTRY.json`.

Do not treat blog, repository stars or release existence as runtime validation. Record upstream source SHA and license review before vendoring third-party skill scripts.
