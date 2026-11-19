// S5(b) API mirror on the r1-backed bridge (validator D, i180/R3).
// propose -> approve with lpRelaxationAcknowledged -> bound run (HiGHS REAL).
import fs from 'node:fs';
import path from 'node:path';

const evDir = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:8792';
const out = (name, obj) => fs.writeFileSync(path.join(evDir, name), JSON.stringify(obj, null, 2) + '\n');
const OPT_TEXT = '最大化 x，其中 x 是 0 到 10 之间的整数，并且 2x 不超过 5。整数最优值是多少？';

const p = await (await fetch(base + '/api/nl/propose', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: OPT_TEXT }),
})).json();
const m = p.proposal.model;
console.log('propose:', p.proposal.status, 'question:', m.question,
  'bounds:', m.variables[0].lower, m.variables[0].upper, 'constr:', JSON.stringify(m.constraints));
out('06-r1-api-propose.json', p);

const a = await (await fetch(base + '/api/nl/approve', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    proposal: p.proposal, approved: true, lpRelaxationAcknowledged: true,
    reviewer: 'e2e-validator-D', note: 'S5(b) r1 API mirror run',
  }),
})).json();
console.log('approve:', a.decision, 'target:', a.target, 'relaxation kind:', a.relaxation?.kind);
out('07-r1-api-approve.json', a);

const r = await (await fetch(base + '/api/runs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: a.plan, approval: { plan_sha256: a.plan_sha256, approved_sha256: a.approval.approved_sha256 } }),
})).json();
console.log('run:', r.run_id, r.status, r?.error?.code || '');
out('08-r1-api-run-started.json', r);

let view = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r2) => setTimeout(r2, 1000));
  view = await (await fetch(base + '/api/runs/' + encodeURIComponent(r.run_id))).json();
  if (view.status !== 'running') break;
}
out('09-r1-api-run-final.json', view);
const s = view.receipt.steps[0];
console.log('final:', view.status, 'outcome:', view.receipt.overall.process_outcome,
  'step:', s.step_id, s.status, 'result:', JSON.stringify(s.result).slice(0, 220));
console.log('solver_answer:', JSON.stringify(view.receipt.overall.solver_answer));
console.log('env portable sha:', view.receipt.environment.formal_portable_root_sha);
