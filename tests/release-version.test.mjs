import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
function loadJson(path) {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'));
}

test('first consumer release v0.0.1 metadata stays consistent with npm lock and MCP handshake', () => {
  const version = readFileSync(new URL('VERSION', root), 'utf8').trim();
  assert.equal(version, '0.0.1');
  const base = loadJson('package.json');
  const core = loadJson('packages/core/package.json');
  const runner = loadJson('packages/runner/package.json');
  const lock = loadJson('package-lock.json');
  assert.equal(base.version, version);
  assert.equal(core.version, version);
  assert.equal(runner.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.equal(lock.packages['packages/core'].version, version);
  assert.equal(lock.packages['packages/runner'].version, version);
  const mcp = readFileSync(new URL('packages/runner/js/mcp.mjs', root), 'utf8');
  assert.match(mcp, /new McpServer\(\{name:"formal-tools-skill",version:"0\.0\.1"\}\)/);
  assert.equal(base.private, true, 'the workspace is not a published npm package');
  assert.equal(runner.private, true, 'runner is not a published npm package');
});
