import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const contract = readFileSync(new URL('../portable/verification/cases/alloy/expect.sh', import.meta.url), 'utf8');
const evidence = JSON.parse(readFileSync(new URL('../docs/tool-portfolio/r77/ALLOY_EXIT_CONTRACT.json', import.meta.url), 'utf8'));

const expectedKeys = [
  'EXPECT_TIMEOUT',
  'EXPECT_POS_ARGS',
  'EXPECT_POS_EXIT',
  'EXPECT_POS_REGEX',
  'EXPECT_POS_LABEL',
  'EXPECT_NEG_ARGS',
  'EXPECT_NEG_EXIT',
  'EXPECT_NEG_REGEX',
  'EXPECT_NEG_LABEL',
  'EXPECT_ERR_ARGS',
  'EXPECT_ERR_EXIT',
  'EXPECT_ERR_REGEX',
  'EXPECT_ERR_LABEL'
];

function exactNumericExits(source) {
  const assignments = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = /^(EXPECT_[A-Z0-9_]+)=('[^'\r\n]*'|[A-Za-z0-9_./:+-]+)$/.exec(line);
    assert.ok(match, 'sourced expect.sh may contain only simple static EXPECT_* assignments');
    const [, key, encodedValue, quotedValue] = match;
    assert.ok(expectedKeys.includes(key), 'unexpected sourced variable: ' + key);
    assert.equal(assignments.has(key), false, 'duplicate sourced variable: ' + key);
    assignments.set(key, quotedValue ?? encodedValue);
  }

  assert.deepEqual([...assignments.keys()].sort(), [...expectedKeys].sort(), 'sourced expect.sh must contain the complete allowlisted assignment set');
  const result = {};
  for (const phase of ['POS', 'NEG', 'ERR']) {
    const value = assignments.get('EXPECT_' + phase + '_EXIT');
    assert.match(value, /^[0-9]+$/, phase + ' requires one unquoted canonical numeric exit');
    result[phase] = Number(value);
  }
  return result;
}

test('Alloy POS NEG ERR exit contracts are exact and narrow', () => {
  assert.deepEqual(exactNumericExits(contract), { POS: 0, NEG: 0, ERR: 1 });
  assert.ok(contract.includes("EXPECT_ERR_REGEX='Syntax error in .*err[.]als at line [0-9]+ column [0-9]+'"));
  assert.ok(!contract.includes("EXPECT_ERR_EXIT='*'"));
});

test('Alloy sourced expect.sh rejects shell commands and every noncanonical assignment', () => {
  const mutations = [
    contract.replace('EXPECT_ERR_EXIT=1', 'EXPECT_ERR_EXIT=*'),
    contract + '\nEXPECT_ERR_EXIT=0\n',
    contract.replace('EXPECT_NEG_EXIT=0\n', ''),
    contract.replace('EXPECT_ERR_EXIT=1', "EXPECT_ERR_EXIT='1'"),
    contract.replace('EXPECT_ERR_EXIT=1', '  EXPECT_ERR_EXIT=1'),
    contract.replace('EXPECT_ERR_EXIT=1', 'export EXPECT_ERR_EXIT=1'),
    contract.replace('EXPECT_ERR_EXIT=1', 'EXPECT_ERR_EXIT=1 ; echo OK'),
    contract.replace('EXPECT_ERR_EXIT=1', 'EXPECT_ERR_EXIT=$(printf 77)'),
    contract + '\nreadonly EXPECT_ERR_EXIT=77\n',
    contract + '\ndeclare EXPECT_ERR_EXIT=77\n',
    contract + '\ndeclare -g EXPECT_ERR_EXIT=77\n',
    contract + '\ntypeset EXPECT_ERR_EXIT=77\n',
    contract + '\nlocal EXPECT_ERR_EXIT=77\n',
    contract + '\nbuiltin readonly EXPECT_ERR_EXIT=77\n',
    contract + '\nprintf -v EXPECT_ERR_EXIT 77\n',
    contract + "\neval 'EXPECT_ERR_EXIT=77'\n",
    contract + '\necho unexpected-command\n'
  ];
  for (const mutant of mutations) assert.throws(() => exactNumericExits(mutant));
});

test('Bash sourcing uses the exact validated POS NEG ERR exits and rejects a live builtin override', () => {
  const command = 'set -euo pipefail; source /dev/stdin; printf "%s:%s:%s" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT"';
  const sourced = execFileSync('bash', ['-c', command], { input: contract, encoding: 'utf8' });
  assert.equal(sourced, '0:0:1');

  const override = contract + '\nreadonly EXPECT_ERR_EXIT=77\n';
  assert.throws(() => exactNumericExits(override));
  const overriddenAtRuntime = execFileSync('bash', ['-c', command], { input: override, encoding: 'utf8' });
  assert.equal(overriddenAtRuntime, '0:0:77');
});

test('Alloy new native ERR evidence binds raw output to observed Java failure and source pins', () => {
  const e = evidence.native_err;
  assert.equal(e.exit_code, 1);
  assert.equal(e.execution_identity, 'UID_GID_65534_HOST_OPENJDK_21_0_12_1');
  assert.match(e.stderr_utf8, /Syntax error in .*err[.]als at line 3 column 10/);
  assert.equal(createHash('sha256').update(e.stderr_utf8).digest('hex'), e.stderr_sha256);
  assert.equal(createHash('sha256').update(e.stdout_utf8).digest('hex'), e.stdout_sha256);
  assert.equal(e.fixture_git_blob, '9b3f8e5f6eedcced1710bf2e0713dd48e5bf2a4c');
  assert.equal(evidence.qualification.T4, 'NOT_QUALIFIED_CURRENT_MAIN_FULL_E2E_NOT_RUN');
});
