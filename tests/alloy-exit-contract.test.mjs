import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const contract = readFileSync(new URL('../portable/verification/cases/alloy/expect.sh', import.meta.url), 'utf8');
const evidence = JSON.parse(readFileSync(new URL('../docs/tool-portfolio/r77/ALLOY_EXIT_CONTRACT.json', import.meta.url), 'utf8'));

function exactNumericExits(source) {
  const assignments = source.split(/\r?\n/).filter(line => /^[ \t]*(?:export[ \t]+)?EXPECT_(?:POS|NEG|ERR)_EXIT=/.test(line));
  const result = {};
  for (const phase of ['POS', 'NEG', 'ERR']) {
    const matches = assignments.filter(line => new RegExp('^EXPECT_' + phase + '_EXIT=[0-9]+$').test(line));
    assert.equal(matches.length, 1, phase + ' requires exactly one canonical numeric exit');
    result[phase] = Number(matches[0].split('=')[1]);
  }
  assert.equal(assignments.length, 3, 'reject duplicate or noncanonical assignments');
  return result;
}

test('Alloy POS NEG ERR exit contracts are exact and narrow', () => {
  assert.deepEqual(exactNumericExits(contract), { POS: 0, NEG: 0, ERR: 1 });
  assert.ok(contract.includes("EXPECT_ERR_REGEX='Syntax error in .*err[.]als at line [0-9]+ column [0-9]+'"));
  assert.ok(!contract.includes("EXPECT_ERR_EXIT='*'"));
});

test('Alloy exit contract rejects wildcard duplicate missing quoted and noncanonical assignments', () => {
  const mutations = [
    contract.replace('EXPECT_ERR_EXIT=1', 'EXPECT_ERR_EXIT=*'),
    contract + '\nEXPECT_ERR_EXIT=0\n',
    contract.replace('EXPECT_NEG_EXIT=0\n', ''),
    contract.replace('EXPECT_ERR_EXIT=1', "EXPECT_ERR_EXIT='1'"),
    contract.replace('EXPECT_ERR_EXIT=1', '  EXPECT_ERR_EXIT=1'),
    contract.replace('EXPECT_ERR_EXIT=1', 'export EXPECT_ERR_EXIT=1'),
    contract.replace('EXPECT_ERR_EXIT=1', 'EXPECT_ERR_EXIT=1 ; echo OK')
  ];
  for (const mutant of mutations) assert.throws(() => exactNumericExits(mutant));
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

