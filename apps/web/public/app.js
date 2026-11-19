/* formal-tools task console — vanilla JS, no build step, no dependencies.
   Talks ONLY to the same-origin bounded bridge (/api/*). The engine is REAL
   (V2 planner/compiler + V3 executor, advertised by /api/meta.engine); when the
   trusted portable tool bundle is absent the run fails closed and the receipt's
   ABORTED / BLOCKED_TOOL_MISSING state is displayed exactly as reported. */
'use strict';

// ---------------------------------------------------------------------------
// Samples (deterministic; the LP sample uses the frozen HiGHS model shape)
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
    sense: 'min',
    objective: [2, 3],
    variables: [{ lower: 0, upper: null }, { lower: 0, upper: null }],
    constraints: [
      { lower: 10, upper: null, coefficients: [1, 1] },
      { lower: null, upper: 4, coefficients: [1, -1] },
    ],
  }, null, 2),
  'smt-nia': `(set-logic QF_NIA)
; Sample: nonlinear integer problem. The receipt decides — real solvers report
; sat, unsat or unknown on their own authority; nothing here pre-scripts it.
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
  'smt-sat': 'SMT cross-check sample A loaded. Expected plan: z3 + cvc5 solve steps and an executor-side cross-check step.',
  'lp': 'HiGHS LP sample B loaded (frozen model shape). Expected plan: one highs solve-lp step.',
  'smt-nia': 'Nonlinear sample loaded. The receipt decides the verdict honestly (sat / unsat / unknown) — if the trusted tool host is reachable.',
  'invalid': 'Malformed sample loaded. The bridge must refuse it fail-closed (422).',
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  meta: null,
  problemText: '',
  plan: null,
  planSource: null,
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
// boot: meta + honest engine badge (no mock badge — the engine is real)
// ---------------------------------------------------------------------------
async function loadMeta() {
  try {
    state.meta = await api('/api/meta');
    $('#modeBadge').textContent = `mode: ${state.meta.mode}`;
    const engineBadge = $('#engineBadge');
    engineBadge.textContent = `engine: ${state.meta.versions.engine} (real)`;
    engineBadge.hidden = false;
    $('#footerMeta').textContent = `engine: ${state.meta.versions.engine} (real — fails closed without the trusted tool bundle)`;
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
  const provider = $('#providerInput').value;

  btn.disabled = true;
  setStatus(statusEl, provider === 'deepseek' ? 'Asking DeepSeek for a method proposal (real call)…' : 'Building plan…');
  try {
    const payload = { problem_text: problemText };
    if (assumptions.length) payload.assumptions = assumptions;
    if (provider) payload.provider = provider;
    const result = await api('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.problemText = problemText;
    setPlan(result.plan, result.plan_source);
    showScreen('plan');
  } catch (err) {
    const hint = err.code === 'BLOCKED_PROVIDER'
      ? ' — select the deterministic template or set DEEPSEEK_API_KEY on the bridge host.'
      : '';
    setStatus(statusEl, `fail-closed (${err.status}) ${err.code}: ${err.message}${hint}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// screen 2: plan review
// ---------------------------------------------------------------------------
function planSourceText(source) {
  if (!source) return '';
  if (source.kind === 'deepseek') {
    return `DeepSeek (${source.model}) — LLM proposal, admitted as data via static validation`;
  }
  return `deterministic template (${source.template}) — built-in, offline`;
}

function setPlan(plan, planSource) {
  state.plan = plan;
  state.planSource = planSource || null;
  renderPlanSummary();
  renderAssumptions(plan.assumptions || []);
  const sourceBadge = $('#planSourceBadge');
  sourceBadge.textContent = planSourceText(planSource);
  sourceBadge.title = state.planSource && state.planSource.kind === 'deepseek'
    ? `method_sha256 ${state.planSource.method_sha256 || '?'} — proposal is untrusted data; validated by buildExecutionPlan before this plan existed`
    : 'Built by the deterministic template; identical problem text always yields an identical plan.';
  $('#planSourceLine').hidden = false;
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
  (assumptions || []).forEach((text, index) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = typeof text === 'string' ? text : '';
    input.maxLength = 256;
    const labelId = `assumption-${index + 1}`;
    input.id = labelId;
    input.dataset.assumptionId = `a${index + 1}`;
    const label = document.createElement('label');
    label.htmlFor = labelId;
    label.className = 'muted';
    label.textContent = `Assumption a${index + 1}`;
    label.style.minWidth = '110px';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'assumption-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove assumption a${index + 1}`);
    removeBtn.addEventListener('click', () => li.remove());
    li.append(label, input, removeBtn);
    list.append(li);
  });
}

function collectAssumptions() {
  return [...document.querySelectorAll('#assumptionList input[type="text"]')]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

$('#addAssumptionBtn').addEventListener('click', () => {
  renderAssumptions([...collectAssumptions(), '']);
  const inputs = document.querySelectorAll('#assumptionList input[type="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

$('#regenBtn').addEventListener('click', async () => {
  const statusEl = $('#planStatus');
  setStatus(statusEl, 'Regenerating plan with edited assumptions…');
  try {
    const payload = { problem_text: state.problemText, assumptions: collectAssumptions() };
    if (state.planSource && state.planSource.kind === 'deepseek') payload.provider = 'deepseek';
    const result = await api('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setPlan(result.plan, result.plan_source);
    setStatus(statusEl, `Plan regenerated: ${result.plan.plan_id}`, 'ok');
  } catch (err) {
    setStatus(statusEl, `fail-closed (${err.status}) ${err.code}: ${err.message}`, 'error');
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
    setStatus(statusEl, `fail-closed (${err.status}) ${err.code}: ${err.message}`, 'error');
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
  const parts = [`run: ${view.run_id}`, `status: ${view.status}`, `plan: ${view.plan_id}`, `engine: ${view.engine}`];
  for (const text of parts) {
    const span = document.createElement('span');
    span.textContent = text;
    meta.append(span);
  }

  if (view.status === 'running') $('#overallBanner').hidden = true;

  const list = $('#runSteps');
  list.textContent = '';
  const receiptSteps = new Map(((view.receipt && view.receipt.steps) || []).map((s) => [s.step_id, s]));

  for (const step of view.plan_summary.steps) {
    const rs = receiptSteps.get(step.id) || {};
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
    const chipStatus = rs.status && rs.status !== 'NOT_RUN' ? rs.status : 'QUEUED';
    head.append(id, statusChip(chipStatus), tool);

    const body = document.createElement('div');
    const streamed = view.streams && view.streams[step.id];
    if (rs.status === 'NOT_RUN' && view.status === 'complete' && view.receipt) {
      // Step never ran (fail-closed before execution) — say so plainly.
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'NOT_RUN — this step never executed (run failed closed before any tool started).';
      body.append(note);
    } else if (streamed || rs.result) {
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
      stdoutPre.textContent = (streamed && streamed.stdout) || '(stdout empty)';
      const stderrPre = document.createElement('pre');
      stderrPre.dataset.stream = 'stderr';
      stderrPre.textContent = (streamed && streamed.stderr) || '(stderr empty)';
      details.append(stdoutPre, stderrPre);
      body.append(details);

      if (rs.result) {
        const resLine = document.createElement('p');
        resLine.className = 'hint';
        resLine.textContent = `result: ${JSON.stringify(rs.result)}`;
        body.append(resLine);
      }
      if (rs.elapsed_ms !== null && rs.elapsed_ms !== undefined) {
        const elapsed = document.createElement('span');
        elapsed.className = 'chip';
        elapsed.textContent = `${rs.elapsed_ms} ms`;
        head.append(elapsed);
      }
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

// ---------------------------------------------------------------------------
// screen 4: results
// ---------------------------------------------------------------------------
function isBlockedRun(receipt) {
  const overall = receipt.overall;
  if (overall.process_outcome !== 'ABORTED') return false;
  const reason = overall.fail_closed_reason || '';
  return reason.startsWith('BLOCKED');
}

function blockedExplanation(receipt) {
  const reason = receipt.overall.fail_closed_reason || 'BLOCKED_TOOL_MISSING';
  const env = receipt.environment || {};
  return `Fail-closed reason: ${reason}. This machine has no trusted portable tool bundle ` +
    `(formal_portable_root_sha: ${env.formal_portable_root_sha || 'none'}). The executor refused the run ` +
    `before any tool started — no step ran, nothing is simulated, and no solver answer is claimed. ` +
    `Real execution happens on the trusted tool host.`;
}

async function renderResults(view) {
  const receipt = view.receipt;
  const overall = receipt.overall;

  // The verdict banner lives ON the results screen (#resultNote) so the honest
  // blocked/fail-closed state is visible where the user lands after the run.
  const banner = $('#resultNote');
  banner.hidden = false;
  banner.className = 'banner';
  banner.textContent = '';
  const title = document.createElement('span');
  title.className = 'banner__title';
  if (isBlockedRun(receipt)) {
    banner.classList.add('banner--blocked');
    title.textContent = 'BLOCKED — TRUSTED TOOLS UNAVAILABLE (fail-closed, nothing simulated)';
    banner.append(title, document.createTextNode(blockedExplanation(receipt)));
  } else if (overall.process_outcome === 'ABORTED' || view.status === 'aborted') {
    banner.classList.add('banner--danger');
    title.textContent = 'ABORTED (fail-closed)';
    banner.append(title, document.createTextNode(overall.fail_closed_reason || 'run did not complete; no result is claimed.'));
  } else if (overall.process_outcome === 'FAILED') {
    banner.classList.add('banner--danger');
    title.textContent = 'FAIL-CLOSED';
    banner.append(title, document.createTextNode(`fail_closed_reason: ${overall.fail_closed_reason || 'unspecified'} — no trustworthy result is claimed.`));
  } else if (overall.cross_tool_verdict === 'CONTRADICTION') {
    banner.classList.add('banner--danger');
    title.textContent = 'CONTRADICTION WARNING';
    banner.append(title, document.createTextNode('The solvers disagree. No trustworthy answer exists for this input; treat the task as unresolved.'));
  } else if (overall.cross_tool_verdict === 'UNKNOWN' || overall.solver_answer.value === 'unknown') {
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
  const solver = overall.solver_answer || {};
  const solverText = solver.value === null || solver.value === undefined
    ? `null (kind: ${solver.kind || 'none'})`
    : String(solver.value);
  const rows = [
    ['process_outcome', 'Technical execution result of the plan (did steps run cleanly?).', overall.process_outcome],
    ['solver_answer', 'What the solver(s) answered about the model itself (null when no step ran).', solverText],
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
    dd.append(chip(String(value), 'chip--' + String(value).replace(/[^A-Z_]/g, '') || 'NOT_RUN'));
    row.append(dt, dd);
    verdictBlock.append(row);
  }
  if (Array.isArray(solver.by_step) && solver.by_step.length) {
    const byStep = document.createElement('p');
    byStep.className = 'hint';
    byStep.textContent = `solver answers by step: ${JSON.stringify(solver.by_step)}`;
    verdictBlock.append(byStep);
  }

  const env = receipt.environment || {};
  const envLine = $('#environmentLine');
  envLine.textContent = `environment — host: ${env.host} · node: ${env.node} · portable root sha: ${env.formal_portable_root_sha || 'none'} · receipt run_id: ${receipt.run_id}`;

  const actions = $('#evidenceActions');
  actions.textContent = '';
  const receiptLink = document.createElement('a');
  receiptLink.className = 'btn btn--ghost';
  receiptLink.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence`;
  receiptLink.setAttribute('download', `receipt-${view.run_id}.json`);
  receiptLink.dataset.testid = 'download-receipt';
  receiptLink.textContent = '⬇ Download receipt (JSON)';
  actions.append(receiptLink);

  const manifestLink = document.createElement('a');
  manifestLink.className = 'btn btn--ghost';
  manifestLink.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence?part=manifest`;
  manifestLink.setAttribute('download', `manifest-${view.run_id}.json`);
  manifestLink.dataset.testid = 'download-manifest';
  manifestLink.textContent = '⬇ Hash manifest (JSON)';
  actions.append(manifestLink);

  // Evidence honesty: the receipt's stream hashes cover the FULL captured
  // streams; the downloadable logs are bounded (<=4 KiB) display copies unless
  // the manifest says a verified full-stream artifact exists. Both hashes are
  // shown labeled; identity is claimed only when the manifest verified it.
  const manifestStreams = await loadEvidenceStreams(view.run_id);
  for (const step of receipt.steps) {
    for (const part of ['stdout', 'stderr']) {
      const bounded = part === 'stdout' ? step.stdout_bounded : step.stderr_bounded;
      if (typeof bounded !== 'string' || bounded.length === 0) continue; // no artifact for a step that never ran
      const fullSha = part === 'stdout' ? step.stdout_sha256 : step.stderr_sha256;
      const entry = manifestStreams ? manifestStreams.get(`${step.step_id}:${part}`) : null;

      const line = document.createElement('p');
      line.className = 'hint';
      line.dataset.testid = 'evidence-hash-line';
      const parts = [`${step.step_id} ${part} — full-stream SHA-256 ${fullSha ? fullSha.slice(0, 12) + '…' : 'none'} (over the FULL captured stream)`];
      if (entry && entry.bounded_sha256) {
        let claim;
        if (entry.bounded_matches_full_stream === true) claim = 'verified identical to the full stream';
        else if (entry.bounded_matches_full_stream === false) claim = 'TRUNCATED prefix — full stream is larger';
        else claim = `capped at ${entry.bounded_bytes} bytes; not verified against the full stream on this host`;
        parts.push(`bounded copy SHA-256 ${entry.bounded_sha256.slice(0, 12)}… (${claim})`);
      }
      line.textContent = parts.join(' · ');
      actions.append(line);

      const boundedLink = document.createElement('a');
      boundedLink.className = 'btn btn--ghost';
      boundedLink.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence?part=${part}&step=${encodeURIComponent(step.step_id)}&scope=bounded`;
      boundedLink.setAttribute('download', `${part}-${step.step_id}.bounded.txt`);
      boundedLink.textContent = `⬇ ${step.step_id} ${part} (bounded ≤4 KiB copy)`;
      actions.append(boundedLink);

      if (entry && entry.full_artifact) {
        const fullLink = document.createElement('a');
        fullLink.className = 'btn btn--ghost';
        fullLink.href = `/api/runs/${encodeURIComponent(view.run_id)}/evidence?part=${part}&step=${encodeURIComponent(step.step_id)}&scope=full`;
        fullLink.setAttribute('download', `${part}-${step.step_id}.txt`);
        fullLink.textContent = `⬇ ${step.step_id} ${part} (full stream)`;
        actions.append(fullLink);
      }
    }
  }
}

/** Best-effort fetch of the run's artifact manifest streams (for hash labels). */
async function loadEvidenceStreams(runId) {
  try {
    const manifest = await api(`/api/runs/${encodeURIComponent(runId)}/evidence?part=manifest`);
    return new Map((manifest.streams || []).map((e) => [`${e.step_id}:${e.stream}`, e]));
  } catch {
    return null; // labels degrade to the receipt's full-stream hash only
  }
}

$('#newTaskBtn').addEventListener('click', () => {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.plan = null;
  state.planSource = null;
  state.runId = null;
  $('#problemText').value = '';
  $('#assumptionsInput').value = '';
  $('#providerInput').value = '';
  $('#problemForm').reset();
  setStatus($('#inputStatus'), '');
  showScreen('input');
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
loadMeta();
showScreen('input');
