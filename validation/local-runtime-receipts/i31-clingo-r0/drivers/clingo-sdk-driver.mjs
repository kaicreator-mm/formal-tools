#!/usr/bin/env node
/**
 * I31 Clingo-only SDK gate driver (canonical Debian 13 container, PR #76 lane).
 * Proves, at the current exact checkout SHA, for the pinned official native
 * clingo binary (FORMAL_CLINGO_BIN from the #24 canonical deb13 bundle):
 *   - staged typed solve with real SAT/UNSAT semantics + stream hashes
 *   - official exit codes carried honestly (30 all-model SAT, 20 UNSAT, 65 invalid)
 *   - invalid-input error path must not parse to a verdict (UNPARSED)
 *   - missing pinned binary fails closed (NOT_STARTED), no PATH substitution
 *   - traversal / absolute staged-option denials, raw pass-through denied
 *   - python-module default contract untouched when FORMAL_CLINGO_BIN is unset
 * Usage: node clingo-sdk-driver.mjs <out-dir>
 * Every case is appended to <out-dir>/sdk-events.ndjson as it completes.
 */
import { mkdtemp, mkdir, writeFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeTool, invokeStagedTool } from "../../../../packages/runner/js/sdk.mjs";
import { executeNativePlan } from "../../../../packages/runner/js/native.mjs";
import { planRawNative } from "../../../../packages/runner/js/native-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = resolve(process.argv[2] ?? "validation/local-runtime-receipts/i31-clingo-r0/sdk");
await mkdir(OUT, { recursive: true });
const events = [];
async function record(event) {
  events.push(event);
  await appendFile(join(OUT, "sdk-events.ndjson"), JSON.stringify(event) + "\n");
}
const assert = (cond, message) => { if (!cond) throw new Error(message); };
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
const shaOk = h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h);

// 0. driver identity: exact checkout + interpreter + pinned launcher provenance.
await record({
  event: "driver_identity",
  checkout: (await import("../../../../scripts/native-acceptance.mjs")).checkoutIdentity(),
  node: process.version,
  clingo_bin: process.env.FORMAL_CLINGO_BIN ?? "(unset)",
  ld_library_path_set: Boolean(process.env.LD_LIBRARY_PATH)
});

// 1. Staged typed solve, positive fixture, default options: ONE answer set,
//    official exit 10 (single-model semantics of the typed `solve` operation).
await check("staged-clingo-positive-satisfiable-exit-10", async () => {
  const r = await invokeStagedTool({
    tool: "clingo", operation: "solve", sourceRoot: ROOT,
    inputs: ["skills/clingo/examples/positive.lp"],
    settings: { input: "skills/clingo/examples/positive.lp" },
    timeoutS: 45
  });
  assert(r.process.exit_code === 10, "expected official single-model exit 10, got " + JSON.stringify(r.process));
  assert(r.process.status === "NONZERO_EXIT", "10 must stay NONZERO_EXIT (honest), got " + r.process.status);
  assert(r.tool_status === "SATISFIABLE", "expected SATISFIABLE, got " + r.tool_status);
  assert(/SATISFIABLE/.test(r.streams.stdout.text), "stdout missing verdict");
  assert((r.streams.stdout.text.match(/^Answer:/gm) ?? []).length === 1, "default solve must stop at 1 answer set");
  assert(shaOk(r.streams.stdout.sha256) && shaOk(r.streams.stderr.sha256), "stream hashes missing");
  return { exit_code: r.process.exit_code, tool_status: r.tool_status, stdout_sha256: r.streams.stdout.sha256, stderr_sha256: r.streams.stderr.sha256 };
});

// 1b. Staged typed solve with models:0 (all models): SATISFIABLE with exactly
//     two enumerated answer sets and the official all-models exit 30 carried
//     verbatim (the same semantics the committed fixture command exercises).
await check("staged-clingo-positive-all-models-exit-30", async () => {
  const r = await invokeStagedTool({
    tool: "clingo", operation: "solve", sourceRoot: ROOT,
    inputs: ["skills/clingo/examples/positive.lp"],
    settings: { input: "skills/clingo/examples/positive.lp", models: 0 },
    timeoutS: 45
  });
  assert(r.process.exit_code === 30, "expected true upstream all-models exit 30, got " + JSON.stringify(r.process));
  assert(r.process.status === "NONZERO_EXIT", "30 must stay NONZERO_EXIT (honest), got " + r.process.status);
  assert(r.tool_status === "SATISFIABLE", "expected SATISFIABLE, got " + r.tool_status);
  assert((r.streams.stdout.text.match(/^Answer:/gm) ?? []).length === 2, "expected exactly 2 answer sets");
  assert(/SATISFIABLE/.test(r.streams.stdout.text), "stdout missing verdict");
  return { exit_code: r.process.exit_code, tool_status: r.tool_status, stdout_sha256: r.streams.stdout.sha256 };
});

// 2. Staged typed solve, negative fixture: UNSATISFIABLE exit 20.
await check("staged-clingo-negative-unsat-exit-20", async () => {
  const r = await invokeStagedTool({
    tool: "clingo", operation: "solve", sourceRoot: ROOT,
    inputs: ["skills/clingo/examples/negative.lp"],
    settings: { input: "skills/clingo/examples/negative.lp" },
    timeoutS: 45
  });
  assert(r.process.exit_code === 20, "expected exit 20, got " + JSON.stringify(r.process));
  assert(r.tool_status === "UNSATISFIABLE", "expected UNSATISFIABLE, got " + r.tool_status);
  assert(shaOk(r.streams.stdout.sha256), "stdout hash missing");
  return { exit_code: r.process.exit_code, tool_status: r.tool_status, stdout_sha256: r.streams.stdout.sha256 };
});

// 3. Error input: invalid ASP syntax must stay UNPARSED with real exit 65.
await check("staged-clingo-invalid-input-exit-65-unparsed", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "i31-sdk-err-"));
  try {
    const bad = "this is not asp )(\n";
    await mkdir(join(scratch, "models"), { recursive: true });
    await writeFile(join(scratch, "models", "broken.lp"), bad);
    const r = await invokeStagedTool({
      tool: "clingo", operation: "solve", sourceRoot: scratch,
      inputs: ["models/broken.lp"],
      settings: { input: "models/broken.lp" },
      timeoutS: 30
    });
    assert(r.process.exit_code === 65, "expected official invalid exit 65, got " + JSON.stringify(r.process));
    assert(r.process.status === "NONZERO_EXIT", "65 must stay NONZERO_EXIT");
    assert(r.tool_status === "UNPARSED", "error input must not parse to a verdict: " + r.tool_status);
    assert(/error/i.test(r.streams.stderr.text), "parser error text missing on stderr");
    assert(shaOk(r.streams.stderr.sha256), "stderr hash missing");
    return { exit_code: r.process.exit_code, tool_status: r.tool_status, stderr_sha256: r.streams.stderr.sha256 };
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

// 4. Missing pinned binary fails closed (NOT_STARTED), even with a PATH that
//    could otherwise resolve a clingo; no PATH substitution.
await check("pinned-binary-missing-fail-closed-not-started", async () => {
  const savedBin = process.env.FORMAL_CLINGO_BIN;
  try {
    process.env.FORMAL_CLINGO_BIN = "/nonexistent/clingo-pinned-for-failure";
    const r = await invokeTool({
      tool: "clingo", operation: "solve",
      settings: { input: "positive.lp" }
    });
    assert(r.process.status === "NOT_STARTED", "expected NOT_STARTED, got " + r.process.status);
    assert(r.tool_status === "INCONCLUSIVE", "missing pinned binary must be INCONCLUSIVE: " + r.tool_status);
    assert(String(r.process.error).includes("clingo-pinned-for-failure"),
      "spawn target must be the pinned path: " + String(r.process.error));
    return { status: r.process.status, tool_status: r.tool_status };
  } finally {
    if (savedBin === undefined) delete process.env.FORMAL_CLINGO_BIN;
    else process.env.FORMAL_CLINGO_BIN = savedBin;
  }
});

// 5. Default contract preserved: with FORMAL_CLINGO_BIN unset the runner keeps
//    the explicit Python module contract (bundle has no clingo wheel: the
//    original #4 gap). Honest NOT_STARTED/INCONCLUSIVE, no fabricated fallback
//    to the native binary and no implicit binary≡module equivalence.
await check("python-module-default-contract-unchanged", async () => {
  const savedBin = process.env.FORMAL_CLINGO_BIN;
  const savedPath = process.env.PATH;
  delete process.env.FORMAL_CLINGO_BIN;
  process.env.PATH = "/usr/bin:/bin";
  try {
    const r = await invokeTool({
      tool: "clingo", operation: "solve",
      settings: { input: "positive.lp" }
    });
    const usedPython = !String(r.process.error ?? "").includes("clingo-pinned-for-failure");
    assert(usedPython, "unpinned run must not use a pinned path: " + String(r.process.error));
    assert(["NOT_STARTED", "NONZERO_EXIT"].includes(r.process.status),
      "python-module lane must fail honestly without a wheel: " + r.process.status);
    assert(r.tool_status === "INCONCLUSIVE", "must stay INCONCLUSIVE: " + r.tool_status);
    return { status: r.process.status, tool_status: r.tool_status, note: "no clingo wheel in canonical bundle; honest fail, original gap preserved" };
  } finally {
    if (savedBin === undefined) delete process.env.FORMAL_CLINGO_BIN;
    else process.env.FORMAL_CLINGO_BIN = savedBin;
    process.env.PATH = savedPath;
  }
});

// 6. Path traversal denied on the staged input manifest.
await check("deny-input-parent-traversal", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "clingo", operation: "solve", sourceRoot: ROOT,
      inputs: ["../outside.lp"], settings: { input: "../outside.lp" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 7. Absolute staged-option path denied.
await check("deny-option-absolute-path", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "clingo", operation: "solve", sourceRoot: ROOT,
      inputs: ["skills/clingo/examples/positive.lp"],
      settings: { input: "/etc/passwd" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 8. Unstaged input option denied (input must reference an explicitly staged file).
await check("deny-unstaged-input-option", async () => {
  let thrown = null;
  try {
    await invokeStagedTool({
      tool: "clingo", operation: "solve", sourceRoot: ROOT,
      inputs: ["skills/clingo/examples/positive.lp"],
      settings: { input: "skills/clingo/examples/negative.lp" }
    });
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 9. Raw native pass-through denied without allowRaw (MCP-facing contract).
await check("raw-passthrough-denied-by-default", async () => {
  let thrown = null;
  try {
    await executeNativePlan(planRawNative("clingo", "clingo", ["--version"]));
  } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, "expected TypeError, got " + thrown);
  return { denied: String(thrown.message) };
});

// 10. Budget semantics: 1s timeout budget on a fast fixture completes; the
//     timeout machinery itself is regression-covered by unit tests. Recorded
//     honestly instead of manufacturing a slow instance.
await check("bounded-budget-completes-within-1s", async () => {
  const r = await invokeStagedTool({
    tool: "clingo", operation: "solve", sourceRoot: ROOT,
    inputs: ["skills/clingo/examples/positive.lp"],
    settings: { input: "skills/clingo/examples/positive.lp" },
    timeoutS: 1
  });
  assert(r.process.status === "NONZERO_EXIT" && r.process.exit_code === 10,
    "1s budget must be enough for the committed fixture: " + JSON.stringify(r.process));
  return { status: r.process.status, exit_code: r.process.exit_code, elapsed_ms: r.process.elapsed_ms };
});

await record({ event: "driver_done", out: OUT, checks: events.filter(x => x.event === "check").length });
process.stdout.write(JSON.stringify({ driver: "sdk", checks: events.filter(x => x.event === "check").length }) + "\n");
