#!/usr/bin/env node
/**
 * I4 R0 SDK gate driver (runs on the engine-provisioned Linux host).
 * Proves, at the current exact checkout SHA:
 *   - trusted staged SDK success with installed engines + artifact hashing
 *   - error-path (invalid model) and timeout semantics (PARTIAL artifacts)
 *   - path traversal / absolute-path / unstaged-option denial (fail closed)
 *   - missing-engine fail-closed (NOT_STARTED, no fabricated status)
 *   - raw native pass-through is denied for non-CLI callers
 * Usage: node sdk-driver.mjs <out-dir>
 * Every case is appended to <out-dir>/sdk-events.ndjson as it completes.
 */
import { mkdtemp, mkdir, writeFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeTool, invokeStagedTool } from "../../../packages/runner/js/sdk.mjs";
import { executeNativePlan } from "../../../packages/runner/js/native.mjs";
import { planRawNative } from "../../../packages/runner/js/native-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(process.argv[2] ?? "validation/local-runtime-receipts/i4-r0/sdk-receipts");
await mkdir(OUT, { recursive: true });
const events = [];
async function record(event) {
  events.push(event);
  await appendFile(join(OUT, "sdk-events.ndjson"), JSON.stringify(event) + "\n");
}
/** Check helper: records assertion outcomes; failures do not abort the lane. */
async function check(name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    await record({ event: "check", name, verdict: "PASS", started, detail: detail ?? null });
    process.stdout.write(JSON.stringify({ name, verdict: "PASS" }) + "\n");
  } catch (e) {
    await record({ event: "check", name, verdict: "FAIL", started, error: String(e && e.message || e) });
    process.stdout.write(JSON.stringify({ name, verdict: "FAIL", error: String(e && e.message || e) }) + "\n");
    process.exitCode = 1;
  }
}
const assert = (cond, message) => { if (!cond) throw new Error(message); };

async function childEnvSanity() {
  // Prove which interpreter the driver used and that the current checkout is the expected one.
  const { checkoutIdentity } = await import("../../../scripts/native-acceptance.mjs");
  return { checkout: checkoutIdentity(), node: process.version };
}

// 1. Staged success with artifact hashing: souffle writes cycle.csv/reach.csv.
await check("staged-souffle-success-artifacts-hashed", async () => {
  const r = await invokeStagedTool({
    tool: "souffle", operation: "run", sourceRoot: ROOT,
    inputs: ["skills/souffle/examples/positive.dl"],
    settings: { input: "skills/souffle/examples/positive.dl", output: "." },
    timeoutS: 60
  });
  assert(r.process.status === "EXIT_ZERO", "souffle run did not exit zero: " + JSON.stringify(r.process));
  assert(r.staging?.status === "STAGED_IN_PRIVATE_WORKSPACE", "missing private staging marker");
  assert(r.artifacts?.status === "COMPLETE", "artifact inventory not COMPLETE: " + r.artifacts?.status);
  const named = r.artifacts.items.map(x => x.path);
  assert(named.length >= 1 && named.some(p => p.endsWith(".csv")), "expected generated CSV artifacts, got " + JSON.stringify(named));
  for (const item of r.artifacts.items) {
    assert(/^[a-f0-9]{64}$/.test(item.sha256), "artifact missing sha256: " + item.path);
    assert(Number.isInteger(item.bytes), "artifact missing bytes: " + item.path);
  }
  return { status: r.process.status, artifacts: r.artifacts.items.length, paths: named };
});

// 2. Staged success (SMT verdict semantics, no artifacts expected).
await check("staged-z3-unsat-success", async () => {
  const r = await invokeStagedTool({
    tool: "z3", operation: "solve", sourceRoot: ROOT,
    inputs: ["skills/z3/examples/positive.smt2"],
    settings: { input: "skills/z3/examples/positive.smt2", timeout: 10 },
    timeoutS: 45
  });
  assert(r.process.status === "EXIT_ZERO", "z3 not EXIT_ZERO: " + JSON.stringify(r.process));
  assert(r.tool_status === "UNSAT", "expected UNSAT outcome, got " + r.tool_status);
  assert(r.streams.stdout.sha256 && r.streams.stderr.sha256, "stream hashes missing");
  return { status: r.process.status, tool_status: r.tool_status, stdout_sha256: r.streams.stdout.sha256 };
});

// 3. Error path: syntactically invalid SMT2 in the staged workspace.
await check("staged-z3-error-input-nonzero", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "i4-sdk-err-"));
  try {
    const bad = "(assert (assert\n";
    await mkdir(join(scratch, "models"), { recursive: true });
    await writeFile(join(scratch, "models", "broken.smt2"), bad);
    const r = await invokeStagedTool({
      tool: "z3", operation: "solve", sourceRoot: scratch,
      inputs: ["models/broken.smt2"],
      settings: { input: "models/broken.smt2" },
      timeoutS: 30
    });
    assert(r.process.status === "NONZERO_EXIT", "expected NONZERO_EXIT, got " + r.process.status);
    assert(r.process.exit_code !== 0, "exit code should be nonzero");
    assert(r.tool_status === "UNPARSED", "error input must not parse to a verdict: " + r.tool_status);
    return { status: r.process.status, exit_code: r.process.exit_code, stderr_sha256: r.streams.stderr.sha256 };
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

// 4. Timeout semantics: 1s budget on a JVM model checker that cannot finish.
await check("staged-tlc-timeout-partial", async () => {
  const r = await invokeStagedTool({
    tool: "tla-tlc", operation: "check", sourceRoot: ROOT,
    inputs: ["skills/tla-tlc/examples/TogglePositive.tla", "skills/tla-tlc/examples/Toggle.cfg"],
    settings: { input: "skills/tla-tlc/examples/TogglePositive.tla", config: "skills/tla-tlc/examples/Toggle.cfg" },
    timeoutS: 1
  });
  assert(r.process.status === "TIMEOUT", "expected TIMEOUT, got " + r.process.status);
  assert(r.process.timed_out === true, "timed_out flag missing");
  assert(r.tool_status === "INCONCLUSIVE", "timeout must stay INCONCLUSIVE: " + r.tool_status);
  assert(r.artifacts?.status === "PARTIAL", "timeout artifacts must be PARTIAL: " + r.artifacts?.status);
  return { status: r.process.status, artifacts_status: r.artifacts?.status };
});

// 5. Path traversal denial on a file-backed option.
await check("deny-option-parent-traversal", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "tla-tlc", operation: "check", sourceRoot: ROOT,
      inputs: ["skills/tla-tlc/examples/TogglePositive.tla", "skills/tla-tlc/examples/Toggle.cfg"],
      settings: { input: "skills/tla-tlc/examples/TogglePositive.tla", config: "../escape.cfg" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 6. Absolute path denial on a staged option.
await check("deny-option-absolute-path", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "tla-tlc", operation: "check", sourceRoot: ROOT,
      inputs: ["skills/tla-tlc/examples/TogglePositive.tla", "skills/tla-tlc/examples/Toggle.cfg"],
      settings: { input: "skills/tla-tlc/examples/TogglePositive.tla", config: "/etc/passwd" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 7. Input manifest traversal denial.
await check("deny-input-manifest-traversal", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "z3", operation: "solve", sourceRoot: ROOT,
      inputs: ["../outside.smt2"], settings: { input: "../outside.smt2" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 8. Unstaged file option denial (file option must reference an explicitly staged input).
await check("deny-unstaged-shapes-option", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "rdf-shacl", operation: "validate", sourceRoot: ROOT,
      inputs: ["skills/rdf-shacl/examples/positive.ttl"],
      settings: { input: "skills/rdf-shacl/examples/positive.ttl", shapes: "skills/rdf-shacl/examples/shapes.ttl" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 9. Missing engine fail-closed: without FORMAL_TOOLS_BIN_DIR, dafny is absent on PATH.
await check("missing-engine-fail-closed-not-started", async () => {
  const saved = process.env.FORMAL_TOOLS_BIN_DIR;
  delete process.env.FORMAL_TOOLS_BIN_DIR;
  try {
    const r = await invokeTool({
      tool: "dafny", operation: "verify",
      settings: { input: "Positive.dfy" }
    });
    assert(r.process.status === "NOT_STARTED", "expected NOT_STARTED, got " + r.process.status);
    assert(r.tool_status === "INCONCLUSIVE", "missing engine must be INCONCLUSIVE: " + r.tool_status);
    return { status: r.process.status, error: r.process.error };
  } finally {
    if (saved !== undefined) process.env.FORMAL_TOOLS_BIN_DIR = saved;
  }
});

// 10. Raw native pass-through denied without allowRaw (MCP-facing contract).
await check("raw-passthrough-denied-by-default", async () => {
  let thrown = null;
  try {
    await executeNativePlan(planRawNative("z3", "z3", ["--version"]));
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

await record({ event: "driver_done", out: OUT, checks: events.filter(x => x.event === "check").length });
const summary = await childEnvSanity();
await record({ event: "driver_identity", ...summary });
process.stdout.write(JSON.stringify({ driver: "sdk", checks: events.filter(x => x.event === "check").length, identity: summary }) + "\n");
