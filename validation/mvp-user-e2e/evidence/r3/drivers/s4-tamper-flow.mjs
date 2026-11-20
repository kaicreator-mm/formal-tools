// S4 tamper-case driver (validator D, i180/R3). Runs the full approval-binding
// substitution sequence against the MOCK_PROVIDER bridge on 127.0.0.1:8791 and
// writes every request/response transcript into the evidence dir.
// Usage: node s4-tamper-flow.mjs <evidenceDir> [baseUrl]
import fs from 'node:fs';
import path from 'node:path';

const evDir = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:8791';
const out = (name, obj) => fs.writeFileSync(path.join(evDir, name), JSON.stringify(obj, null, 2) + '\n');

const TEXT_A = '找出整数 x 和 y：x 至少是 3，y 至少是 1，两个都不超过 50，x+y 恰好是 7 的倍数，并且 y 不超过 x。这样的整数对存在吗？';
const TEXT_B = '最大化 3x+2y，其中 x 和 y 都是非负整数，x+y 不超过 4，并且 x 不超过 3。';

const post = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const step = async (name, fn) => {
  const r = await fn();
  console.log(`${name}: http=${r.status} code=${r.json?.error?.code || r.json?.decision || r.json?.proposal?.status}`);
  return r;
};

// 1. propose model A (sat) and approve it.
const a1 = await step('01 propose A', () => post('/api/nl/propose', { text: TEXT_A }));
out('01-propose-A.json', a1.json);
const propA = a1.json.proposal;
if (propA.status !== 'MODEL_PROPOSED') throw new Error('A not MODEL_PROPOSED');
const a2 = await step('02 approve A', () => post('/api/nl/approve', {
  proposal: propA, approved: true, reviewer: 'e2e-validator-D', note: 'S4 control approval of model A',
}));
out('02-approve-A.json', a2.json);
const planA = a2.json.plan, apprA = a2.json.approval;

// 2. propose model B (optimize; stub dispatch) and approve it WITH the LP ack
//    (B is only a substitution victim here; the ack keeps it approvable).
const b1 = await step('03 propose B', () => post('/api/nl/propose', { text: TEXT_B }));
out('03-propose-B.json', b1.json);
const propB = b1.json.proposal;
if (propB.status !== 'MODEL_PROPOSED') throw new Error('B not MODEL_PROPOSED');
const b2 = await step('04 approve B', () => post('/api/nl/approve', {
  proposal: propB, approved: true, lpRelaxationAcknowledged: true,
  reviewer: 'e2e-validator-D', note: 'S4 model B approval for substitution test',
}));
out('04-approve-B.json', b2.json);
const planB = b2.json.plan, apprB = b2.json.approval;

// 3. TAMPER variant 1 — plan A submitted under B's approval binding.
const t1 = await step('05 TAMPER planA+approvalB', () => post('/api/runs', { plan: planA, approval: apprB }));
out('05-tamper-planA-approvalB.json', { submitted: { plan_sha256_submitted: apprB.plan_sha256, approved_sha256_submitted: apprB.approved_sha256, actual_plan_sha256: planA.plan_id }, http_status: t1.status, response: t1.json });

// 4. TAMPER variant 2 — mutated plan A bytes with A's own binding.
const planA2 = JSON.parse(JSON.stringify(planA));
planA2.steps[0].timeout_s = 999; // single-field mutation
const t2 = await step('06 TAMPER mutatedPlanA+approvalA', () => post('/api/runs', { plan: planA2, approval: apprA }));
out('06-tamper-mutatedPlanA-approvalA.json', { submitted: { mutation: 'steps[0].timeout_s 30 -> 999', plan_sha256_submitted: apprA.plan_sha256, approved_sha256_submitted: apprA.approved_sha256 }, http_status: t2.status, response: t2.json });

// 5. TAMPER variant 3 — fabricated binding that matches no approval in this process.
const t3 = await step('07 TAMPER unknown binding', () => post('/api/runs', {
  plan: planA,
  approval: { plan_sha256: 'f'.repeat(64), approved_sha256: 'e'.repeat(64) },
}));
out('07-tamper-unknown-binding.json', { submitted: { plan_sha256_submitted: 'f'.repeat(64) }, http_status: t3.status, response: t3.json });

// 6. POSITIVE CONTROL — the untouched plan A with its own approval binding runs.
const p1 = await step('08 CONTROL planA+approvalA', () => post('/api/runs', { plan: planA, approval: apprA }));
out('08-control-run-started.json', p1.json);
if (!p1.json.run_id) throw new Error('positive control did not start');
// poll to completion for the receipt (real z3+cvc5 on the trusted host)
let view = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(`${base}/api/runs/${encodeURIComponent(p1.json.run_id)}`);
  view = await res.json();
  if (view.status !== 'running') break;
}
out('09-control-run-final.json', view);
console.log('09 control run final:', view.status, 'overall:', JSON.stringify(view.receipt?.overall?.process_outcome), 'solver:', view.receipt?.overall?.solver_answer?.value, 'cross:', view.receipt?.overall?.cross_tool_verdict);
