/* formal-tools task console — vanilla JS, no build step, no dependencies.
   Talks ONLY to the same-origin bounded bridge (/api/*). Engine is mock-v1 this round;
   the MOCKED badge (from /api/meta.mocked_contracts) is shown in the header. */
'use strict';

// ---------------------------------------------------------------------------
// Samples (deterministic, matching the bridge's mock engine expectations)
// ---------------------------------------------------------------------------
const SAMPLES = {
  'smt-sat': `(set-logic QF_LIA)
; Sample A: satisfiable arithmetic puzzle, cross-checked by z3 + cvc5
(declare-const x Int)
(declare-const y Int)
(assert (>= x 0))
(assert (>= y 0))
(assert (= (+ x y) 10))
(assert (= (- x y) 2))
(check-sat)
(exit)
`,
  'lp': JSON.stringify({
    objective: { direction: 'minimize', coeffs: { x: 2, y: 3 } },
    variables: { x: { lower: 0 }, y: { lower: 0 } },
    constraints: [
      { name: 'demand', expr: 'x + y >= 10' },
      { name: 'mix', expr: 'x - y <= 4' },
    ],
  }, null, 2),
  'smt-unknown': `(set-logic QF_NIA)
; Sample: nonlinear problem the simulated solvers honestly report as unknown
;; @expect: unknown
(declare-const x Int)
(declare-const y Int)
(assert (= (* x x y y) 2))
(assert (> x 0))
(check-sat)
(exit)
`,
  'invalid': `this is not a model, just prose !!!`,
};

const SAMPLE_TITLES = {
  'smt-sat': 'SMT cross-check sample A loaded. Expected: z3 and cvc5 agree on sat.',
  'lp': 'HiGHS LP sample B loaded. Expected: optimal objective value.',
  'smt-unknown': 'UNKNOWN sample loaded. Solvers will honestly report "unknown".',
  'invalid': 'Malformed sample loaded. The bridge must refuse it fail-closed (422).',
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  meta: null,
  problemText: '',
  plan: null,
  runId: null,
  pollTimer: null,
};

const $ = (sel) => document.querySelector(sel);

const SCREENS = {
  input: $('#screen-input'),
  plan: $('#screen-plan'),
  run: $('#screen-run'),
  results: $('#screen-results'),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(SCREENS)) el.hidden = key !== name;
  const order = ['input', 'plan', 'run', 'results'];
  const activeIdx = order.indexOf(name);
  document.querySelectorAll('#stepper li').forEach((li) => {
    const idx = order.indexOf(li.dataset.step);
    li.removeAttribute('aria-current');
    li.removeAttribute('data-state');
    if (idx === activeIdx) li.setAttribute('aria-current', 'step');
    else if (idx < activeIdx) li.setAttribute('data-state', 'done');
  });
  const heading = SCREENS[name].querySelector('h1');
  if (heading) heading.focus({ preventScroll: false });
}

function setStatus(el, message, tone) {
  el.textContent = message || '';
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

function chip(text, extraClass) {
  const span = document.createElement('span');
  span.className = `chip ${extraClass || 'chip--' + String(text).replace(/[^A-Z_]/g, '')}`;
  span.textContent = text;
  span.dataset.testid = 'chip';
  return span;
}

function statusChip(status) {
  if (status === 'running') return chip('RUNNING', 'chip--running');
  if (status === 'queued') return chip('QUEUED', 'chip--queued');
  return chip(status, 'chip--' + status);
}

// ---------------------------------------------------------------------------
// API helper (same-origin only)
// ---------------------------------------------------------------------------
async function api(pathname, options = {}) {
  let res;
  try {
    res = await fetch(pathname, { headers: { 'Accept': 'application/json' }, ...options });
  } catch (err) {
    throw { status: 0, code: 'NETWORK', message: `bridge unreachable: ${err.message}` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw {
      status: res.status,
      code: (body && body.error && body.error.code) || `HTTP_${res.status}`,
      message: (body && body.error && body.error.message) || `request failed with status ${res.status}`,
    };
  }
  return body;
}

// ---------------------------------------------------------------------------
// boot: meta + badges
// ---------------------------------------------------------------------------
async function loadMeta() {
  try {
    state.meta = await api('/api/meta');
    $('#modeBadge').textContent = `mode: ${state.meta.mode}`;
    $('#footerMeta').textContent = `engine: ${state.meta.versions.engine} (simulated)`;
    if (state.meta.mocked_contracts) {
      $('#mockBadge').hidden = false;
    }
  } catch (err) {
    $('#modeBadge').textContent = 'mode: bridge unreachable';
  }
}

// ---------------------------------------------------------------------------
// screen 1: problem input
// ---------------------------------------------------------------------------
document.querySelectorAll('.sample-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sample;
    $('#problemText').value = SAMPLES[key];
    setStatus($('#inputStatus'), SAMPLE_TITLES[key]);
    $('#problemText').focus();
  });
});

$('#problemForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = $('#planBtn');
  const statusEl = $('#inputStatus');
  const problemText = $('#problemText').value;
  const assumptionsRaw = $('#assumptionsInput').value;
  const assumptions = assumptionsRaw.split('\n').map((s) => s.trim()).filter(Boolean);

  btn.disabled = true;
  setStatus(statusEl, 'Building plan…');
  try {
    const payload = { problem_text: problemText };
    if (assumptions.length) payload.assumptions = assumptions;
    const result = await api('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.problemText = problemText;
    setPlan(result.plan, result.assumptions);
    showScreen('plan');
  } catch (err) {
    setStatus(statusEl, `fail-closed (${err.status}): ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// screen 2: plan review
// ---------------------------------------------------------------------------
function setPlan(plan, assumptions) {
  state.plan = plan;
  renderPlanSummary();
  renderAssumptions(assumptions);
  $('#planJson').textContent = JSON.stringify(plan, null, 2);
  $('#approveCheck').checked = false;
  $('#approveBtn').disabled = true;
  setStatus($('#planStatus'), '');
}

function renderPlanSummary() {
  const plan = state.plan;
  const banner = $('#planBanner');
  banner.hidden = false;
  banner.className = 'banner banner--info';
  banner.textContent = '';
  const strong = document.createElement('span');
  strong.className = 'banner__title';
  strong.textContent = `Plan ${plan.plan_id} · kind: ${plan.source.problem_kind}`;
  banner.append(strong, document.createTextNode(
    `problem_sha256 ${plan.source.problem_sha256.slice(0, 12)}… · ${plan.steps.length} step(s) · budget ${plan.budgets.max_total_timeout_s}s · compiled manifest ${plan.compiled.manifest_sha256.slice(0, 12)}…`,
  ));

  const tbody = $('#stepsBody');
  tbody.textContent = '';
  for (const step of plan.steps) {
    const tr = document.createElement('tr');
    const cells = [
      step.id, step.tool, step.operation,
      step.depends_on.length ? step.depends_on.join(', ') : '—',
      `${step.timeout_s}s`,
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderAssumptions(assumptions) {
  const list = $('#assumptionList');
  list.textContent = '';
  (assumptions || []).forEach((a, index) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = a.text;
    input.maxLength = 500;
    const labelId = `assumption-${a.id || index}`;
    input.id = labelId;
    input.dataset.assumptionId = a.id || String(index + 1);
    const label = document.createElement('label');
    label.htmlFor = labelId;
    label.className = 'muted';
    label.textContent = `Assumption ${a.id || index + 1}`;
    label.style.minWidth = '110px';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'assumption-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove assumption ${a.id || index + 1}`);
    removeBtn.addEventListener('click', () => li.remove());
    li.append(label, input, removeBtn);
    list.append(li);
  });
}

function collectAssumptions() {
  return [...document.querySelectorAll('#assumptionList input[type="text"]')]
    .map((input, i) => ({ id: input.dataset.assumptionId || `a${i + 1}`, text: input.value.trim() }))
    .filter((a) => a.text);
}

$('#addAssumptionBtn').addEventListener('click', () => {
  const planAssumptions = state.plan ? state.plan.assumptions : [];
  renderAssumptions([...collectAssumptions(), { id: `a${planAssumptions.length + 1}`, text: '' }]);
  const inputs = document.querySelectorAll('#assumptionList input[type="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

$('#regenBtn').addEventListener('click', async () => {
  const statusEl = $('#planStatus');
  setStatus(statusEl, 'Regenerating plan with edited assumptions…');
  try {
    const result = await api('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem_text: state.problemText, assumptions: collectAssumptions().map((a) => a.text) }),
    });
    setPlan(result.plan, result.assumptions);
    setStatus(statusEl, `Plan regenerated: ${result.plan.plan_id}`, 'ok');
  } catch (err) {
    setStatus(statusEl, `fail-closed (${err.status}): ${err.message}`, 'error');
  }
});

$('#approveCheck').addEventListener('change', (event) => {
  $('#approveBtn').disabled = !event.target.checked;
});

$('#backBtn').addEventListener('click', () => showScreen('input'));

$('#approveBtn').addEventListener('click', async () => {
  const btn = $('#approveBtn');
  const statusEl = $('#planStatus');
  btn.disabled = true;
  setStatus(statusEl, 'Starting run…');
  try {
    const result = await api('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: state.plan }),
    });
    state.runId = result.run_id;
    setStatus(statusEl, `Run started: ${result.run_id}`, 'ok');
    startRunView();
  } catch (err) {
    setStatus(statusEl, `fail-closed (${err.status}): ${err.message}`, 'error');
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// screen 3: run view (1s polling)
// ---------------------------------------------------------------------------
const expandedSteps = new Set(); // keep <details> open across 1s re-renders

function startRunView() {
  showScreen('run');
  expandedSteps.clear();
  $('#runSteps').textContent = '';
  $('#overallBanner').hidden = true;
  setStatus($('#runStatus'), 'Polling every 1s…');
  if (state.pollTimer) clearInterval(state.pollTimer);
  pollRunOnce();
  state.pollTimer = setInterval(pollRunOnce, 1000);
}

async function pollRunOnce() {
  if (!state.runId) return;
  let view;
  try {
    view = await api(`/api/runs/${encodeURIComponent(state.runId)}`);
  } catch (err) {
    setStatus($('#runStatus'), `poll failed: ${err.message}`, 'error');
    return;
  }
  renderRun(view);
  if (view.status !== 'running') {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    renderResults(view);
    showScreen('results');
  }
}

function renderRun(view) {
  const meta = $('#runMeta');
  meta.textContent = '';
  const parts = [`run: ${view.run_id}`, `status: ${view.status}`, `plan: ${view.plan_id}`];
  for (const text of parts) {
    const span = document.createElement('span');
    span.textContent = text;
    meta.append(span);
  }

  const banner = $('#overallBanner');
  if (view.status === 'running') {
    banner.hidden = true;
  }

  const list = $('#runSteps');
  list.textContent = '';
  const receiptSteps = new Map(((view.receipt && view.receipt.steps) || []).map((s) => [s.step_id, s]));

  for (const step of view.plan_summary.steps) {
    const rs = receiptSteps.get(step.id) || {};
    const liveState = (view.step_states && view.step_states[step.id]) || 'queued';
    const li = document.createElement('li');
    li.className = 'run-step';
    li.dataset.stepId = step.id;

    const head = document.createElement('div');
    head.className = 'run-step__head';
    const id = document.createElement('span');
    id.className = 'run-step__id';
    id.textContent = step.id;
    const tool = document.createElement('span');
    tool.className = 'run-step__tool';
    tool.textContent = `${step.tool} · ${step.operation} · deps: ${step.depends_on.length ? step.depends_on.join(', ') : '—'} · timeout ${step.timeout_s}s`;
    const chipStatus = rs.status === 'NOT_RUN' && liveState === 'running' ? 'RUNNING'
      : rs.status === 'NOT_RUN' ? 'QUEUED'
      : rs.status || 'QUEUED';
    head.append(id, statusChip(chipStatus), tool);

    const body = document.createElement('div');
    if (rs.status && rs.status !== 'NOT_RUN') {
      const details = document.createElement('details');
      if (expandedSteps.has(step.id)) details.open = true;
      details.addEventListener('toggle', () => {
        if (details.open) expandedSteps.add(step.id);
        else expandedSteps.delete(step.id);
      });
      const summary = document.createElement('summary');
      summary.textContent = 'stdout / stderr excerpt';
      details.append(summary);

      const stdoutPre = document.createElement('pre');
      stdoutPre.dataset.stream = 'stdout';
      stdoutPre.textContent = streamText(view, step.id, 'stdout') || '(stdout empty)';
      const stderrPre = document.createElement('pre');
      stderrPre.dataset.stream = 'stderr';
      stderrPre.textContent = streamText(view, step.id, 'stderr') || '(stderr empty)';
      details.append(stdoutPre, stderrPre);
      body.append(details);

      if (rs.result && rs.result.kind && rs.result.kind !== 'pending') {
        const resLine = document.createElement('p');
        resLine.className = 'hint';
        resLine.textContent = `result: ${JSON.stringify(rs.result)}`;
        body.append(resLine);
      }
      if (rs.elapsed_ms) {
        const elapsed = document.createElement('span');
        elapsed.className = 'chip';
        elapsed.textContent = `${rs.elapsed_ms} ms`;
        head.append(elapsed);
      }
    } else if (rs.result && rs.result.kind === 'skipped') {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = rs.result.reason || 'skipped (fail-closed)';
      body.append(note);
    }
    li.append(head, body);
    list.append(li);
  }

  setStatus(
    $('#runStatus'),
    view.status === 'running' ? 'Run in progress…' : `Run ${view.status}.`,
    view.status === 'running' ? undefined : view.status === 'complete' ? 'ok' : 'error',
  );
}

function streamText(view, stepId, part) {
  // bounded streams ship alongside the partial receipt in the run view JSON
  return view.streams && view.streams[stepId] ? view.streams[stepId][part] : null;
}

// ---------------------------------------------------------------------------
// screen 4: results
// ---------------------------------------------------------------------------
async function renderResults(view) {
  const receipt = view.receipt;
  const overall = receipt.overall;

  const banner = $('#overallBanner');
  banner.hidden = false;
  banner.className = 'banner';
  banner.textContent = '';
  const title = document.createElement('span');
  title.className = 'banner__title';
  if (overall.process_outcome === 'FAILED' || view.status === 'aborted') {
    banner.classList.add('banner--danger');
    title.textContent = 'FAIL-CLOSED';
    banner.append(title, document.createTextNode(overall.fail_closed_reason || 'run did not complete; no result is claimed.'));
  } else if (overall.cross_tool_verdict === 'CONTRADICTION') {
    banner.classList.add('banner--danger');
    title.textContent = 'CONTRADICTION WARNING';
    banner.append(title, document.createTextNode('The solvers disagree. No trustworthy answer exists for this input; treat the task as unresolved.'));
  } else if (overall.cross_tool_verdict === 'UNKNOWN' || overall.solver_answer === 'unknown') {
    banner.classList.add('banner--unknown');
    title.textContent = 'UNKNOWN';
    banner.append(title, document.createTextNode('Tools ran but could not decide the query. This is an honest outcome — not sat, not unsat, not an error.'));
  } else if (overall.process_outcome === 'OK') {
    banner.classList.add('banner--ok');
    title.textContent = 'RUN COMPLETE';
    banner.append(title, document.createTextNode('All steps executed under the plan budget.'));
  } else {
    banner.classList.add('banner--warn');
    title.textContent = `process_outcome ${overall.process_outcome}`;
    banner.append(title, document.createTextNode(overall.fail_closed_reason || ''));
  }

  const verdictBlock = $('#verdictBlock');
  verdictBlock.textContent = '';
  const rows = [
    ['process_outcome', 'Technical execution result of the plan (did steps run cleanly?).', overall.process_outcome],
    ['solver_answer', 'What the solver(s) answered about the model itself.', overall.solver_answer === null ? '—' : String(overall.solver_answer)],
    ['cross_tool_verdict', 'Agreement between independent tools (only for cross-check plans).', overall.cross_tool_verdict],
    ['claim_verdict', 'Verdict about a user claim; no claim submitted in this MVP sample.', overall.claim_verdict],
  ];
  for (const [name, desc, value] of rows) {
    const row = document.createElement('div');
    row.className = 'verdict-row';
    const dt = document.createElement('dt');
    dt.textContent = name;
    const descSpan = document.createElement('span');
    descSpan.className = 'verdict-desc';
    descSpan.textContent = desc;
    dt.append(descSpan);
    const dd = document.createElement('dd');
    dd.append(chip(String(value), 'chip--' + String(value)));
    row.append(dt, dd);
    verdictBlock.append(row);
  }

  const note = $('#resultNote');
  note.hidden = true;

  const actions = $('#evidenceActions');
  actions.textContent = '';
  const receiptLink = document.createElement('a');
  receiptLink.className = 'btn btn--ghost';
  receiptLink.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence`;
  receiptLink.setAttribute('download', `receipt-${view.run_id}.json`);
  receiptLink.dataset.testid = 'download-receipt';
  receiptLink.textContent = '⬇ Download receipt + streams (JSON)';
  actions.append(receiptLink);

  for (const step of receipt.steps) {
    for (const part of ['stdout', 'stderr']) {
      const link = document.createElement('a');
      link.className = 'btn btn--ghost';
      link.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence?part=${part}&step=${encodeURIComponent(step.step_id)}`;
      link.setAttribute('download', `${part}-${step.step_id}.txt`);
      link.textContent = `⬇ ${step.step_id} ${part}`;
      actions.append(link);
    }
  }
}

$('#newTaskBtn').addEventListener('click', () => {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.plan = null;
  state.runId = null;
  $('#problemText').value = '';
  $('#assumptionsInput').value = '';
  $('#problemForm').reset();
  setStatus($('#inputStatus'), '');
  showScreen('input');
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
loadMeta();
showScreen('input');
