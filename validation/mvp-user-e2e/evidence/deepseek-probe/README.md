# DeepSeek planning probe evidence (i180/V6, issue #186)

`transcript.json` is the REAL response of one live call to
`https://api.deepseek.com/chat/completions` (model `deepseek-chat`, temperature 0),
run from `validation/mvp-user-e2e/harness/run-deepseek-plan.mjs` on 2026-11-19.

- kind: **PROBE_NOT_FINAL_E2E** — connectivity/shape proof only. This is NOT the
  final E2E run; the Method DAG in the transcript was never executed.
- The Authorization header is redacted by construction; the API key is read from the
  `DEEPSEEK_API_KEY` environment variable and never recorded. (The offline test
  re-asserts the env key does not appear anywhere in this transcript.)
- Observed result: HTTP 200; the assistant proposed a 3-node DAG
  (z3 solve-smt, cvc5 solve-smt, compare cross-check on z3+cvc5), fully inside the
  pinned tool/operation allowlist (proposal_mapping.ok = true).
- LIVE SINCE 646859f (V6): the real planning step of the E2E has run — see
  `live-cli/j1-unsat-deepseek.*` (real DeepSeek plan -> compiled -> executed ->
  AGREE_UNSAT / PASS), `live-mcp/` (the same proposal reproduced over MCP at
  temperature 0), and `live-web/screenshots/02-plan-deepseek-llm.png`.
