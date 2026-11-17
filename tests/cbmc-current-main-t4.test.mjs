import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

let mcpDependenciesAvailable = true;
try { await import('@modelcontextprotocol/server'); await import('zod/v4'); }
catch { mcpDependenciesAvailable = false; }

const evidence = JSON.parse(await readFile(resolve('docs/tool-portfolio/r99/CBMC_CURRENT_MAIN_T4.json'), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitBlobSha1 = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const digest = value => assert.match(value, /^[a-f0-9]{64}$/);

test('CBMC R99 evidence is bound to the requested exact main and current source blobs', async () => {
  assert.equal(evidence.schema, 'formal-tools/cbmc-current-main-t4/1');
  assert.equal(evidence.exact_main, '530a2d7a8edf99106845be228b6451c6aa52be92');
  assert.equal(evidence.main_push.status, 'SUCCESS');
  assert.equal(evidence.main_push.pipeline, 1867);
  assert.equal(evidence.main_push.commit, evidence.exact_main);
  assert.match(evidence.main_push.url, /pipeline\/1867\/1$/);
  const reconciliation = evidence.current_main_reconciliation;
  assert.equal(reconciliation.latest_main, '387a21d70c9a411117ffd75e312e72062649b8df');
  assert.equal(reconciliation.tested_main, evidence.exact_main);
  assert.equal(reconciliation.status, 'SOURCE_PINS_UNCHANGED');
  assert.deepEqual(reconciliation.source_pin_overlap, []);
  assert.equal(reconciliation.main_push.pipeline, 1875);
  assert.equal(reconciliation.main_push.status, 'SUCCESS');
  assert.match(reconciliation.main_push.url, /pipeline\/1875\/1$/);
  assert.equal(reconciliation.branch_sync.first_parent, reconciliation.latest_main);
  assert.equal(reconciliation.branch_sync.second_parent, 'd1ce09116a1b4ff0e815f6a26dbfdfa139b385fd');
  for (const [path, expected] of Object.entries(evidence.source_pins)) {
    assert.equal(gitBlobSha1(await readFile(resolve(path))), expected, 'Git blob mismatch: ' + path);
  }
});

test('original CBMC archive, fixtures and metadata overlay are accurately distinguished', () => {
  assert.equal(evidence.archives.cbmc.sha256, 'eaa049099a7a515631b4c82699b264e4bea1e677d9f65e8374cf212d30306369');
  assert.equal(evidence.archives.cbmc.size_bytes, 20600381);
  assert.equal(evidence.bundle_overlay.original_meta_sh.identity, 'TOOL_TOOL_ID');
  assert.equal(evidence.bundle_overlay.regenerated_meta_sh.identity, 'TOOL_ID');
  assert.equal(evidence.bundle_overlay.meta_json_unchanged_sha256, 'f09b83bf3b6c1f8c4a586fa76dc7f759deedcc0dc0d50bb7e8902ed2f0748d76');
  assert.equal(evidence.bundle_overlay.fixtures_match_current_main, true);
});

test('exact current-main Runner executed CBMC POS/NEG/ERR with authentic exit contracts', () => {
  const r = evidence.runner;
  assert.equal(evidence.bundle_overlay.runner_git_blob_sha1, evidence.source_pins['portable/packaging/bundle-template/bin/tool-runner']);
  assert.equal(evidence.bundle_overlay.runner_sha256, '020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a');
  assert.equal(r.uid, 65534); assert.equal(r.gid, 65534); assert.equal(r.bundle_write_protected, true);
  assert.equal(r.doctor.exit_code, 0); assert.equal(sha256(r.doctor.stdout), r.doctor.stdout_sha256);
  assert.equal(r.version_native.exit_code, 0); assert.match(r.version_native.stdout, /6\.11\.0/);
  assert.equal(r.verify.exit_code, 0); assert.equal(sha256(r.verify.receipt_tsv), r.verify.receipt_sha256);
  assert.match(r.verify.receipt_tsv, /verdict\tPASS/);
  assert.deepEqual(r.verify.cases.map(x => [x.phase, x.exit_code, x.pattern_matched, x.exit_contract_matched]), [
    ['pos', 0, true, true], ['neg', 10, true, true], ['err', 3, true, true]
  ]);
  for (const phase of ['pos', 'neg', 'err']) assert.equal(sha256(r.verify.raw_case_logs[phase].stdout), r.verify.raw_case_logs[phase].sha256);
});

test('CLI and SDK execute the current-main CBMC gate and fail closed on wrong Runner pins', () => {
  assert.equal(evidence.cli.inspect_status, 'FOUND_PINNED_NOT_EXECUTED');
  assert.equal(evidence.cli.doctor.status, 'DOCTOR_EXECUTED_NOT_T3');
  assert.equal(evidence.cli.doctor.exit_code, 0); digest(evidence.cli.doctor.stdout_sha256);
  assert.equal(evidence.cli.verify.status, 'FIXTURE_TECHNICAL_PASS_UNREVIEWED');
  assert.equal(evidence.cli.verify.exit_code, 0); digest(evidence.cli.verify.stdout_sha256);
  assert.deepEqual(evidence.cli.verify.cases.map(x => [x.phase, x.exit_code]), [['pos', 0], ['neg', 10], ['err', 3]]);
  assert.equal(evidence.cli.wrong_runner_pin.status, 'NOT_RUN_FAIL_CLOSED');
  assert.equal(evidence.cli.wrong_runner_pin.exit_code, 2);
  assert.equal(evidence.sdk.doctor_status, 'DOCTOR_EXECUTED_NOT_T3');
  assert.equal(evidence.sdk.verify_status, 'FIXTURE_TECHNICAL_PASS_UNREVIEWED');
  digest(evidence.sdk.stdout_sha256);
  assert.deepEqual(evidence.sdk.cases.map(x => [x.phase, x.exit_code]), [['pos', 0], ['neg', 10], ['err', 3]]);
  assert.equal(evidence.sdk.wrong_runner_pin.status, 'NOT_RUN_FAIL_CLOSED');
});

test('MCP remains NOT_RUN locally because exact locked packages are absent; no mock pass is claimed', () => {
  assert.equal(evidence.mcp.status, 'NOT_RUN_LOCKED_DEPENDENCIES_NOT_INSTALLED');
  assert.equal(evidence.mcp.installed, false);
  assert.deepEqual(evidence.mcp.locked_dependencies, {'@modelcontextprotocol/server':'2.4.0','@modelcontextprotocol/core':'2.4.0',zod:'4.6.7'});
  assert.equal(evidence.mcp.error_code, 'ERR_MODULE_NOT_FOUND');
  digest(evidence.mcp.stderr_sha256);
});

test('evidence does not grant T4 qualification or promote later lifecycle gates', () => {
  assert.match(evidence.result.t4, /NOT_GRANTED_PENDING_INDEPENDENT_REVIEW/);
  assert.equal(evidence.result.t5, 'NOT_QUALIFIED');
  assert.equal(evidence.result.t6, 'OPEN');
  assert.equal(evidence.result.product, 'NOT_GRANTED');
  assert.equal(evidence.result.release, 'NOT_GRANTED');
});

test('MCP stdio server executes real discovery and typed CBMC tool calls when lockfile dependencies are installed', { skip: !mcpDependenciesAvailable }, async () => {
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