#!/usr/bin/env node
// formal-tools i180/R3 E2E (validator subagent D) — MOCK_PROVIDER driver server.
//
// Starts the REAL apps/web bridge (startServer) with the deterministic stub NL
// provider injected through the bridge's documented nlProviderImpl test seam
// (exactly the seam apps/web-tests/nl.test.mjs uses). Purpose: the stub
// scenarios of the R3 acceptance (S2 rejection, S4 approval-binding tamper,
// S5 LP-relaxation gate) must not consume real-DeepSeek budget; everything
// downstream of the proposal (revise/approve/plan/execution) is the REAL
// server code path on every one of these scenarios — only the translation
// reply is a deterministic stub, honestly labeled MOCK_PROVIDER.
//
// NOT part of the CI test glob (real-chain drivers live outside it, following
// the tests/nl-model.driver.mjs pattern). Run: PORT=8791 node mock-provider-server.mjs
// The executor environment (FORMAL_PORTABLE_ROOT / FORMAL_PORTABLE_RUNNER_SHA256)
// is inherited from process.env so S5(b) executes HiGHS for REAL on the trusted host.

import { startServer } from '../../../../../apps/web/server.mjs';

// S2/S4 model: bounded integer sat problem (auxiliary k for the multiple-of-7 phrasing).
const SAT_MODEL = {
  variables: [
    { name: 'x', integer: true, lower: 3, upper: 50 },
    { name: 'y', integer: true, lower: 1, upper: 50 },
    { name: 'k', integer: true, lower: 1, upper: 14 },
  ],
  constraints: [
    { coefficients: { x: 1, y: 1, k: -7 }, op: '==', rhs: 0 },
    { coefficients: { y: 1, x: -1 }, op: '<=', rhs: 0 },
  ],
  question: 'sat',
  assumptions: ['auxiliary k: x+y = 7*k', 'k bounded because 4 <= x+y <= 100'],
};

// S5 model (the recommended integer-optimize repro variant): maximize x,
// 2x <= 5, x integer in [0,10] -> integer optimum 2, LP relaxation optimum 2.5.
const OPT_MODEL = {
  variables: [{ name: 'x', integer: true, lower: 0, upper: 10 }],
  constraints: [{ coefficients: { x: 2 }, op: '<=', rhs: 5 }],
  question: 'optimize',
  objective: { direction: 'maximize', coefficients: { x: 1 } },
  assumptions: ['x in [0,10] as stated in the text', '2x <= 5 stated in the text'],
};

const stubProvider = {
  model: 'stub-nl-model-mock-provider',
  generate: async (prompt) => {
    const t = String(prompt?.original_text || '');
    if (t.includes('最大化')) return structuredClone(OPT_MODEL);
    return structuredClone(SAT_MODEL);
  },
};

const port = Number(process.env.PORT || 8791);
const started = await startServer({
  host: '127.0.0.1',
  port,
  nlProviderImpl: stubProvider,
  executorEnv: process.env, // trusted-host env (portable bundle) flows through unchanged
});
console.log(`MOCK_PROVIDER_NL_SERVER_LISTENING host=127.0.0.1 port=${started.port} provider=stub-nl-model-mock-provider`);
