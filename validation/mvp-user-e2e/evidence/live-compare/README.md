# Cross-entry comparison (V6 live, issue #186)

Built by `harness/build-entry-reports.mjs` from the committed live evidence only
(no re-runs, no synthesized values). Comparison semantics:

- **cli-vs-mcp — MATCH (exact)**: the CLI `workflow plan` (deterministic
  template, scenario-A SMT2 + the two bridge-default assumptions) and the MCP
  `plan_workflow` call (same problem text, same assumptions) returned the
  IDENTICAL plan object — same plan_id `wf-e759e1d5b18abf629caa2398a609b56a`
  and identical plan_sha256; the executed CLI receipt's plan_sha256 equals the
  MCP plan object's canonical hash. MCP is planning-only by contract, so the
  outcome fields compare as SKIP (not a fabricated pass).
- **cli-vs-web — MATCH**: the web bridge normalizes the same problem with
  `problem_kind: "smt2"` (CLI records `user_problem`), so the plan envelopes
  and plan_ids differ; the comparison falls back to the step-set signature —
  identical (same z3/cvc5/compare steps, same canonical input hashes) — plus
  the executed outcome classes, which match exactly (AGREE_UNSAT on both).
  The plan_sha256 field is reported honestly as MATCH_SEMANTIC, never as an
  exact hash match.
- **mcp-vs-web — MATCH**: same rule (MCP plan identity vs web step signature).

DeepSeek determinism: the real LLM planner (temperature 0) produced the SAME
plan `wf-1023fdabe42c64cbc0d5677766aa925f` through the CLI journey and through
the MCP `provider:'deepseek'` call — recorded in `bindings`.
