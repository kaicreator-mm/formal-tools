import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// R102 P1-02 + R148 P1-01: the MCP stdio integration test must not be able to
// silently skip in CI. Dependency-import failure stays a tolerated local skip,
// but under any accepted CI environment signal it is a hard failure of this
// test file. Official Woodpecker pipelines set CI=woodpecker and CI_PIPELINE_*
// (not CI=true), which the previous CI=true-only check misdetected; GitHub
// Actions and generic CI set CI=true. All three signals are accepted.
let mcpDependenciesAvailable = true;
let mcpImportError = null;
try { await import('@modelcontextprotocol/server'); await import('zod/v4'); }
catch (e) { mcpDependenciesAvailable = false; mcpImportError = String(e); }
const ciValue = String(process.env.CI ?? '').trim().toLowerCase();
const runningInCi = ciValue === 'true' || ciValue === 'woodpecker' ||
  Object.keys(process.env).some(key => key.startsWith('CI_PIPELINE_'));
if (runningInCi && !mcpDependenciesAvailable) {
  throw new Error('MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI: ' + mcpImportError);
}

const RAW = 'docs/tool-portfolio/r99/cbmc-current-main-t4/raw';
const RAW_ROOT = resolve(RAW);
const evidence = JSON.parse(await readFile(resolve('docs/tool-portfolio/r99/CBMC_CURRENT_MAIN_T4.json'), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sha256File = async rel => sha256(await readFile(resolve(RAW_ROOT, ...rel.split('/'))));
const rawText = async rel => (await readFile(resolve(RAW_ROOT, ...rel.split('/')))).toString('utf8');
const rawExit = async rel => Number((await rawText(rel + '.exit')).trim());
const gitBlobSha1 = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const digest = value => assert.match(value, /^[a-f0-9]{64}$/);
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('CBMC T4 evidence is bound to the tested current main and 22 source blobs', async () => {
  assert.equal(evidence.schema, 'formal-tools/cbmc-current-main-t4/2');
  assert.equal(evidence.tested_main.sha, 'b9a662f48079d855aac69c886f228cce89efa8c6');
  assert.equal(evidence.tested_main.main_push.status, 'SUCCESS');
  assert.equal(evidence.tested_main.main_push.pipeline, 2062);
  assert.equal(evidence.tested_main.main_push.commit, evidence.tested_main.sha);
  assert.match(evidence.tested_main.main_push.url, /pipeline\/2062\/1$/);
  assert.equal(evidence.exact_main_historical.sha, '530a2d7a8edf99106845be228b6451c6aa52be92');
  assert.equal(evidence.exact_main_historical.main_push.pipeline, 1867);
  assert.equal(evidence.exact_main_historical.main_push.status, 'SUCCESS');

test('r177 shared-interface wiring is recorded as additive post-window pin drift', async () => {
  const r177 = evidence.source_pin_drift.shared_interface_r177;
  assert.equal(r177.base_main, 'e5b4f62e1e650d2785a7ee3970102c5218b9d3de');
  assert.equal(r177.output_label, 'FORMAL_TOOLS_I24_R177_CAPABILITY_INTERFACE_CLOSEOUT');
  assert.equal(r177.unchanged_pinned_paths, 19);
  assert.deepEqual(r177.changed_pinned_paths.map(p => p.path),
    ['packages/runner/js/cli.mjs', 'packages/runner/js/sdk.mjs', 'packages/runner/js/mcp.mjs']);
  for (const entry of r177.changed_pinned_paths) {
    assert.equal(gitBlobSha1(await readFile(resolve(entry.path))), entry.new_blob, 'post-wiring blob mismatch: ' + entry.path);
    assert.notEqual(entry.new_blob, entry.old_blob, entry.path);
  }
});
  const drift = evidence.source_pin_drift;
  assert.equal(drift.window.commits, 83);
  assert.deepEqual(drift.changed_pinned_paths.map(p => p.path),
    ['portable/packaging/bundle-template/bin/tool-runner', 'packages/runner/js/native.mjs']);
  assert.equal(drift.unchanged_pinned_paths, 20);
  for (const [path, expected] of Object.entries(evidence.source_pins)) {
    assert.equal(gitBlobSha1(await readFile(resolve(path))), expected, 'Git blob mismatch: ' + path);
  }
});

test('raw evidence inventory is internally consistent (SHA256SUMS recomputed)', async () => {
  const inv = evidence.raw_evidence;
  assert.equal(inv.sha256sums_file, 'SHA256SUMS');
  const sums = await rawText('SHA256SUMS');
  assert.equal(await sha256File('SHA256SUMS'), inv.sha256sums_sha256);
  const lines = sums.trimEnd().split('\n');
  assert.equal(lines.length, inv.file_count);
  for (const line of lines) {
    const [hash, ...rest] = line.split('  ');
    assert.equal(await sha256File(rest.join('  ')), hash, 'raw file hash mismatch: ' + rest.join('  '));
  }
});

test('original CBMC archive, fixtures and metadata overlay are accurately distinguished', () => {
  assert.equal(evidence.archives.cbmc.sha256, 'eaa049099a7a515631b4c82699b264e4bea1e677d9f65e8374cf212d30306369');
  assert.equal(evidence.archives.cbmc.size_bytes, 20600381);
  assert.equal(evidence.archives.portable_core.sha256, 'fe9699e6ba503d94826551bc8e82c70c7c267191a89a6a14941e3551e2b23990');
  assert.equal(evidence.archives.portable_core.size_bytes, 27989);
  assert.equal(evidence.bundle_overlay.original_meta_sh.identity, 'TOOL_TOOL_ID');
  assert.equal(evidence.bundle_overlay.regenerated_meta_sh.identity, 'TOOL_ID');
  assert.equal(evidence.bundle_overlay.meta_json_unchanged_sha256, 'f09b83bf3b6c1f8c4a586fa76dc7f759deedcc0dc0d50bb7e8902ed2f0748d76');
  assert.equal(evidence.bundle_overlay.fixtures_match_current_main, true);
  assert.equal(evidence.bundle_overlay.runner_git_blob_sha1, evidence.source_pins['portable/packaging/bundle-template/bin/tool-runner']);
  assert.equal(evidence.bundle_overlay.runner_sha256, '60af447ecfbc401549a7bbaab56e4111e0ca1d66a19bdc81e9eb479bdcd26c71');
});

test('exact current-main Runner executed CBMC POS/NEG/ERR; raw bytes recompute every hash', async () => {
  const r = evidence.runner;
  assert.equal(r.uid, 65534); assert.equal(r.gid, 65534); assert.equal(r.bundle_write_protected, true);
  assert.equal(r.doctor.exit_code, await rawExit('runner/doctor'));
  assert.equal(r.doctor.stdout, await rawText('runner/doctor.stdout'));
  assert.equal(r.doctor.stdout_sha256, await sha256File('runner/doctor.stdout'));
  assert.equal(r.doctor.stderr_sha256, EMPTY_SHA);
  assert.equal(r.version_metadata.exit_code, 0); assert.match(r.version_metadata.stdout, /version: 6\.11\.0/);
  assert.equal(r.version_metadata.stdout_sha256, await sha256File('runner/version-metadata.stdout'));
  assert.equal(r.version_native.exit_code, await rawExit('runner/version-native'));
  assert.equal(r.version_native.stdout, await rawText('runner/version-native.stdout'));
  assert.match(r.version_native.stdout, /6\.11\.0/);
  assert.equal(r.verify.exit_code, await rawExit('runner/verify'));
  assert.equal(r.verify.stdout, await rawText('runner/verify.stdout'));
  assert.equal(r.verify.stderr_sha256, EMPTY_SHA);
  assert.equal(sha256(r.verify.receipt_tsv), r.verify.receipt_sha256);
  assert.equal(r.verify.receipt_sha256, await sha256File('runner/verify.receipt.tsv'));
  assert.equal(r.verify.receipt_tsv, await rawText('runner/verify.receipt.tsv'));
  assert.match(r.verify.receipt_tsv, /verdict\tPASS/);
  assert.deepEqual(r.verify.cases.map(x => [x.phase, x.exit_code, x.pattern_matched, x.exit_contract_matched]), [
    ['pos', 0, true, true], ['neg', 10, true, true], ['err', 3, true, true]
  ]);
  for (const phase of ['pos', 'neg', 'err']) {
    const log = r.verify.raw_case_logs[phase];
    assert.equal(log.combined_output, await rawText('runner/verify-cbmc.' + phase + '.log'));
    assert.equal(log.sha256, await sha256File('runner/verify-cbmc.' + phase + '.log'));
    assert.match(log.combined_output, new RegExp('PHASE_DONE phase=' + phase + ' rc=' + { pos: 0, neg: 10, err: 3 }[phase]));
  }
  assert.equal(r.verify.raw_case_logs.stream_capture, 'STDOUT_AND_STDERR_MERGED');
});

test('NEG/ERR exit observations are explicit and the wildcard fixture contract is disclosed (R102 P2-02)', async () => {
  const semantics = evidence.runner.verify.exit_contract_semantics;
  assert.equal(semantics.pos.declared, 'EXPECT_POS_EXIT=0');
  assert.equal(semantics.neg.declared, "EXPECT_NEG_EXIT='*' (wildcard)");
  assert.equal(semantics.err.declared, "EXPECT_ERR_EXIT='*' (wildcard)");
  assert.equal(semantics.pos.observed_exit, 0);
  assert.equal(semantics.neg.observed_exit, 10);
  assert.equal(semantics.err.observed_exit, 3);
  assert.match(semantics.note, /wildcard/);
  assert.match(semantics.note, /preserve the 22 source pins/);
});

test('CLI raw receipts recompute from committed bytes, including wrong-pin fail-closed (R102 P1-01)', async () => {
  const cli = evidence.cli;
  assert.equal(cli.inspect.exit_code, await rawExit('cli/inspect'));
  assert.equal(cli.inspect.status, 'FOUND_PINNED_NOT_EXECUTED');
  assert.equal(cli.inspect.stdout_sha256, await sha256File('cli/inspect.stdout'));
  assert.equal(cli.inspect.stderr_sha256, EMPTY_SHA);
  assert.equal(cli.inspect.runner_sha256, evidence.bundle_overlay.runner_sha256);
  assert.equal(cli.inspect.metadata_sha256, evidence.bundle_overlay.meta_json_unchanged_sha256);

  assert.equal(cli.doctor.exit_code, await rawExit('cli/doctor'));
  assert.equal(cli.doctor.status, 'DOCTOR_EXECUTED_NOT_T3');
  assert.equal(cli.doctor.stdout_sha256, await sha256File('cli/doctor.stdout'));
  assert.equal(cli.doctor.stderr_sha256, await sha256File('cli/doctor.stderr'));
  const doctorDoc = JSON.parse(await rawText('cli/doctor.stdout'));
  assert.equal(doctorDoc.streams.stdout, await rawText('runner/doctor.stdout'));

  assert.equal(cli.verify.exit_code, await rawExit('cli/verify'));
  assert.equal(cli.verify.status, 'FIXTURE_TECHNICAL_PASS_UNREVIEWED');
  assert.equal(cli.verify.stdout_sha256, await sha256File('cli/verify.stdout'));
  assert.equal(cli.verify.stderr_sha256, await sha256File('cli/verify.stderr'));
  assert.equal(cli.verify.receipt_sha256, await sha256File('cli/verify.receipt.tsv'));
  assert.deepEqual(cli.verify.cases.map(x => [x.phase, x.exit_code]), [['pos', 0], ['neg', 10], ['err', 3]]);
  const verifyDoc = JSON.parse(await rawText('cli/verify.stdout'));
  assert.equal(verifyDoc.receipt_sha256, cli.verify.receipt_sha256);
  assert.deepEqual(verifyDoc.cases, cli.verify.cases);
  const tsvRows = (await rawText('cli/verify.receipt.tsv')).trimEnd().split('\n').map(l => l.split('\t'));
  assert.equal(tsvRows.at(-1).join('\t'), 'verdict\tPASS');
  assert.deepEqual(tsvRows.slice(1, -1).map(r => [r[1], Number(r[2]), r[6]]),
    cli.verify.cases.map(c => [c.phase, c.exit_code, c.label]));

  assert.equal(cli.wrong_runner_pin.exit_code, await rawExit('cli/wrong-runner-pin'));
  assert.equal(cli.wrong_runner_pin.exit_code, 2);
  assert.equal(cli.wrong_runner_pin.status, 'NOT_RUN_FAIL_CLOSED');
  assert.match(cli.wrong_runner_pin.reason, /PORTABLE_RUNNER_SHA256_MISMATCH/);
  assert.equal(cli.wrong_runner_pin.stdout_sha256, await sha256File('cli/wrong-runner-pin.stdout'));
  assert.equal(cli.wrong_runner_pin.stderr_sha256, await sha256File('cli/wrong-runner-pin.stderr'));
  assert.ok(cli.wrong_runner_pin.argv.includes('portfolio'));
});

test('SDK typed results recompute from committed bytes; harness exit is not an operation exit (R102 P2-01)', async () => {
  const sdk = evidence.sdk;
  assert.equal(sdk.doctor.harness_exit_code, await rawExit('sdk/doctor'));
  assert.equal(sdk.doctor.status, 'DOCTOR_EXECUTED_NOT_T3');
  assert.equal(sdk.doctor.stdout_sha256, await sha256File('sdk/doctor.stdout'));
  const doctorDoc = JSON.parse(await rawText('sdk/doctor.stdout'));
  assert.equal(doctorDoc.status, 'DOCTOR_EXECUTED_NOT_T3');
  assert.equal(doctorDoc.streams.stdout, await rawText('runner/doctor.stdout'));

  assert.equal(sdk.verify.harness_exit_code, await rawExit('sdk/verify'));
  assert.equal(sdk.verify.harness_exit_code, 0);
  assert.equal(sdk.verify.status, 'FIXTURE_TECHNICAL_PASS_UNREVIEWED');
  assert.equal(sdk.verify.stdout_sha256, await sha256File('sdk/verify.stdout'));
  assert.equal(sdk.verify.stderr_sha256, await sha256File('sdk/verify.stderr'));
  assert.equal(sdk.verify.receipt_sha256, await sha256File('sdk/verify.receipt.tsv'));
  assert.deepEqual(sdk.verify.cases.map(x => [x.phase, x.exit_code]), [['pos', 0], ['neg', 10], ['err', 3]]);
  const verifyDoc = JSON.parse(await rawText('sdk/verify.stdout'));
  assert.equal(verifyDoc.receipt_sha256, sdk.verify.receipt_sha256);
  assert.deepEqual(verifyDoc.cases, sdk.verify.cases);

  assert.equal(sdk.wrong_runner_pin.harness_exit_code, await rawExit('sdk/wrong-runner-pin'));
  assert.equal(sdk.wrong_runner_pin.status, 'NOT_RUN_FAIL_CLOSED');
  assert.match(sdk.wrong_runner_pin.reason, /PORTABLE_RUNNER_SHA256_MISMATCH/);
  assert.equal(sdk.wrong_runner_pin.stdout_sha256, await sha256File('sdk/wrong-runner-pin.stdout'));
  assert.equal(sdk.wrong_runner_pin.stderr_sha256, await sha256File('sdk/wrong-runner-pin.stderr'));
  assert.match(sdk.wrong_runner_pin.exit_semantics, /harness_exit_code/);
  assert.ok(!('exit_code' in sdk.wrong_runner_pin), 'ambiguous exit_code must not be reintroduced');
});

test('MCP stays NOT_RUN locally with the raw failure captured; CI gate makes skips impossible', async () => {
  assert.equal(evidence.mcp.status, 'NOT_RUN_LOCKED_DEPENDENCIES_NOT_INSTALLED');
  assert.equal(evidence.mcp.installed, false);
  assert.deepEqual(evidence.mcp.locked_dependencies, {'@modelcontextprotocol/server':'2.4.0','@modelcontextprotocol/core':'2.4.0',zod:'4.6.7'});
  assert.equal(evidence.mcp.error_code, 'ERR_MODULE_NOT_FOUND');
  assert.equal(evidence.mcp.exit_code, await rawExit('mcp/no-deps'));
  assert.equal(evidence.mcp.stderr_sha256, await sha256File('mcp/no-deps.stderr'));
  assert.match(await rawText('mcp/no-deps.stderr'), /ERR_MODULE_NOT_FOUND/);
  assert.equal(evidence.mcp.ci_gate.repair_round, 'R148 P1-01');
  assert.match(evidence.mcp.ci_gate.mechanism, /hard failure/);
  assert.match(evidence.mcp.ci_gate.mechanism, /CI=woodpecker/);
  assert.match(evidence.mcp.ci_gate.mechanism, /CI_PIPELINE_/);
  assert.deepEqual(evidence.mcp.ci_gate.ci_env_signals, ['CI=true', 'CI=woodpecker', 'CI_PIPELINE_*']);
  assert.equal(evidence.mcp.ci_gate.negative_examples.length, 4);
  for (const example of evidence.mcp.ci_gate.negative_examples.slice(0, 3)) {
    assert.match(example.expected, /nonzero/);
    assert.match(example.expected, /MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI/);
  }
  assert.equal(evidence.mcp.ci_gate.negative_examples[0].env.CI, 'woodpecker');
  assert.equal(evidence.mcp.ci_gate.negative_examples[1].env.CI, 'true');
  assert.equal(evidence.mcp.ci_gate.negative_examples[2].env.CI_PIPELINE_NUMBER, 'set, CI unset');
  assert.equal(evidence.mcp.ci_gate.negative_examples[3].env.CI, 'unset');
  assert.match(evidence.mcp.ci_gate.negative_examples[3].expected, /exits 0/);
  assert.match(evidence.mcp.ci_gate.negative_examples[3].expected, /local-only skip/);
  assert.match(evidence.mcp.ci_gate.negative_example_mechanism, /REAL committed test file/);
  assert.match(evidence.mcp.ci_gate.negative_example_mechanism, /CBMC_T4_GATE_PROBE/);
});

test('evidence does not grant T4 qualification or promote later lifecycle gates', () => {
  assert.match(evidence.result.t4, /NOT_GRANTED_PENDING_INDEPENDENT_REVIEW/);
  assert.equal(evidence.result.t5, 'NOT_QUALIFIED');
  assert.equal(evidence.result.t6, 'OPEN');
  assert.equal(evidence.result.product, 'NOT_GRANTED');
  assert.equal(evidence.result.release, 'NOT_GRANTED');
});

test('MCP stdio server executes real discovery and typed CBMC tool calls when lockfile dependencies are installed', { skip: mcpDependenciesAvailable ? false : 'MCP dependencies not installed (local-only skip)' }, async () => {
  const env = { ...process.env };
  delete env.FORMAL_PORTABLE_ROOT;
  delete env.FORMAL_PORTABLE_RUNNER_SHA256;
  delete env.FORMAL_PORTABLE_META_SHA256;
  delete env.FORMAL_PORTABLE_FIXTURE_SHA256;
  const child = spawn(process.execPath, ['packages/runner/js/mcp.mjs'], {
    cwd: process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe']
  });
  const reader = createInterface({ input: child.stdout });
  const lines = reader[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const nextLine = async () => {
    let timer;
    try {
      const item = await Promise.race([
        lines.next(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('MCP stdio response timeout')), 10000); })
      ]);
      assert.equal(item.done, false, 'MCP server closed stdout before replying: ' + stderr);
      return JSON.parse(item.value);
    } finally { clearTimeout(timer); }
  };
  const request = async (message, id) => {
    child.stdin.write(JSON.stringify(message) + '\n');
    for (;;) {
      const response = await nextLine();
      if (response.id === id) return response;
    }
  };
  try {
    const initialized = await request({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cbmc-r99-test', version: '1.0.0' } }
    }, 1);
    assert.equal(initialized.error, undefined, JSON.stringify(initialized));
    assert.ok(initialized.result?.serverInfo);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const listed = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 2);
    const names = listed.result.tools.map(tool => tool.name);
    assert.ok(names.includes('list_formal_tools'));
    assert.ok(names.includes('inspect_portfolio_tool'));
    assert.ok(names.includes('verify_portable_fixture'));

    const portfolio = await request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_formal_tools', arguments: {} } }, 3);
    const portfolioResult = JSON.parse(portfolio.result.content[0].text);
    assert.equal(portfolioResult.portfolio.length, 36);
    assert.ok(portfolioResult.portfolio.some(tool => tool.id === 'cbmc'));

    const inspected = await request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'inspect_portfolio_tool', arguments: { tool: 'cbmc' } } }, 4);
    const inspectResult = JSON.parse(inspected.result.content[0].text);
    assert.equal(inspectResult.status, 'NOT_AVAILABLE_FAIL_CLOSED');

    const verified = await request({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'verify_portable_fixture', arguments: { tool: 'cbmc' } } }, 5);
    const verifyResult = JSON.parse(verified.result.content[0].text);
    assert.equal(verifyResult.status, 'NOT_RUN_FAIL_CLOSED');
    assert.equal(verified.result.isError, true);
  } finally {
    reader.close();
    child.kill('SIGTERM');
  }
});

// R148 P1-01 negative examples: the CI gate above must fail closed, never skip,
// when the MCP dependencies are missing in a CI environment. Each negative
// example re-runs the REAL committed test file in a child process with a module
// hook that makes '@modelcontextprotocol/server' unresolvable
// (ERR_MODULE_NOT_FOUND), reproducing the missing-dependency condition even
// where a parent node_modules would otherwise provide the package. Probe
// children set CBMC_T4_GATE_PROBE=1 so these negative examples do not recurse.
const GATE_PROBE_DIR = await mkdtemp(join(tmpdir(), 'cbmc-t4-gate-probe-'));
await writeFile(join(GATE_PROBE_DIR, 'gate-hook.mjs'), [
  "export async function resolve(specifier, context, nextResolve) {",
  "  if (specifier === '@modelcontextprotocol/server') {",
  "    const error = new Error(\"Cannot find package '@modelcontextprotocol/server'\");",
  "    error.code = 'ERR_MODULE_NOT_FOUND';",
  "    throw error;",
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
  ""
].join('\n'));
await writeFile(join(GATE_PROBE_DIR, 'hook-register.mjs'), [
  "import { register } from 'node:module';",
  "register('./gate-hook.mjs', import.meta.url);",
  ""
].join('\n'));
const gateProbeChild = process.env.CBMC_T4_GATE_PROBE === '1';
const gateProbeSkip = gateProbeChild ? 'gate-probe child run' : false;
const runGateProbe = async envOverrides => {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, CBMC_T4_GATE_PROBE: '1' };
  delete env.CI;
  // Under `node --test` the runner marks per-file children with NODE_TEST_*,
  // which would make the probe child emit the NDJSON child-reporter protocol
  // instead of the standalone spec output these probes assert on. Strip it so
  // every probe child behaves like a plain `node tests/...` run.
  for (const key of Object.keys(env)) {
    if (key.startsWith('CI_PIPELINE_') || key.startsWith('NODE_TEST_')) delete env[key];
  }
  Object.assign(env, envOverrides);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath,
      ['--import', pathToFileURL(join(GATE_PROBE_DIR, 'hook-register.mjs')).href,
       resolve('tests/cbmc-current-main-t4.test.mjs')],
      { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolvePromise({ code, signal, output }); });
    child.on('error', error => { clearTimeout(timer); rejectPromise(error); });
  });
};
after(async () => { await rm(GATE_PROBE_DIR, { recursive: true, force: true }); });

test('CI gate probe: CI=woodpecker with missing MCP deps fails nonzero, never skips (R148 P1-01)', { skip: gateProbeSkip }, async () => {
  const probe = await runGateProbe({ CI: 'woodpecker' });
  assert.notEqual(probe.code, 0);
  assert.match(probe.output, /MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI/);
  assert.doesNotMatch(probe.output, /# /);
});

test('CI gate probe: CI=true with missing MCP deps fails nonzero, never skips (R148 P1-01)', { skip: gateProbeSkip }, async () => {
  const probe = await runGateProbe({ CI: 'true' });
  assert.notEqual(probe.code, 0);
  assert.match(probe.output, /MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI/);
  assert.doesNotMatch(probe.output, /# /);
});

test('CI gate probe: CI_PIPELINE_* alone with missing MCP deps fails nonzero, never skips (R148 P1-01)', { skip: gateProbeSkip }, async () => {
  const probe = await runGateProbe({ CI_PIPELINE_NUMBER: '1' });
  assert.notEqual(probe.code, 0);
  assert.match(probe.output, /MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI/);
  assert.doesNotMatch(probe.output, /# /);
});

test('CI gate probe: missing MCP deps outside CI stays a local-only skip with exit 0 (R148 P1-01)', { skip: gateProbeSkip }, async () => {
  const probe = await runGateProbe({});
  assert.equal(probe.code, 0);
  assert.match(probe.output, /MCP stdio server executes real discovery and typed CBMC tool calls when lockfile dependencies are installed[^\n]*# /);
  assert.doesNotMatch(probe.output, /MCP_LOCKED_DEPENDENCIES_UNAVAILABLE_IN_CI/);
  assert.match(probe.output, /fail 0/);
});
