import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planWorkflow, compileWorkflowPlan, executeWorkflowPlan,
  WorkflowError, WorkflowPlanError, WorkflowBlockedError
} from "../packages/runner/js/sdk.mjs";
import { sha256Canonical } from "../packages/runner/js/workflow-plan.mjs";

/**
 * i180/V4b end-to-end coverage of the ONE reusable workflow contract across
 * SDK, CLI and MCP: plan (deterministic template / real DeepSeek) -> compile
 * -> execute (honest fail-closed without binaries) -> results. Binary-less
 * environments legitimately produce ABORTED/BLOCKED receipts with
 * fail_closed_reason BLOCKED_TOOL_MISSING — that is honesty, not a failure.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cliPath = join(repoRoot, "packages", "runner", "js", "cli.mjs");
const mcpPath = join(repoRoot, "packages", "runner", "js", "mcp.mjs");

/** Bounded SMT-LIB fixture: genuinely solvable, deterministic bytes. */
const SMT_PROBLEM = [
  "(set-logic QF_LIA)",
  "(declare-const x Int)",
  "(assert (> x 0))",
  "(assert (< x 0))",
  "(check-sat)",
  "(exit)"
].join("\n");

/** Environment without the pinned portable bundle: execution must fail closed. */
function scrubEnv(...keys) {
  const env = { ...process.env };
  for (const key of ["FORMAL_PORTABLE_ROOT", "FORMAL_PORTABLE_RUNNER_SHA256", "DEEPSEEK_API_KEY", ...keys]) delete env[key];
  return env;
}

function makeTmp(label) {
  return mkdtempSync(join(tmpdir(), "wf-v4b-" + label + "-"));
}

async function errorCode(fn) {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof WorkflowError, "expected WorkflowError, got " + String(e));
    return /** @type {WorkflowError} */ (e).code;
  }
  throw new Error("expected WorkflowError, nothing thrown");
}

test("V4b SDK: planWorkflow deterministic template plans z3+cvc5+compare with NOT_RUN discipline", async () => {
  const a = await planWorkflow({ problemText: SMT_PROBLEM, assumptions: ["bounded linear integer arithmetic"] });
  const b = await planWorkflow({ problemText: SMT_PROBLEM, assumptions: ["bounded linear integer arithmetic"] });
  assert.equal(a.plan.schema, "formal-tools/execution-plan/1.0");
  assert.match(a.plan.plan_id, /^wf-[a-f0-9]{32}$/);
  assert.equal(a.plan.plan_id, b.plan.plan_id, "same input must yield the same plan_id");
  assert.deepEqual(a.plan.steps.map(s => s.tool + "/" + s.operation),
    ["z3/solve-smt", "cvc5/solve-smt", "compare/cross-check"]);
  // canonical problem text is used verbatim as the trusted solver input
  for (const step of a.plan.steps.filter(s => s.tool !== "compare"))
    assert.equal((/** @type {any} */ (step.input)).smt_lib, SMT_PROBLEM);
  assert.deepEqual(a.plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  assert.deepEqual(a.plan.method_dag.map(d => d.kind), ["solve", "solve", "cross_check"]);
  assert.equal(a.problem.schema, "formal-tools/problem-spec/0.1");
  assert.deepEqual(a.plan.assumptions, ["bounded linear integer arithmetic"]);
});

test("V4b SDK: planWorkflow request validation is precise (unknown fields, provider enum, template caps)", async () => {
  assert.equal(await errorCode(() => planWorkflow(/** @type {any} */ ({ problemText: "ok", nope: 1 }))), "PLAN_SCHEMA_INVALID");
  assert.equal(await errorCode(() => planWorkflow(/** @type {any} */ ({ problemText: "ok", provider: "bogus" }))), "PLAN_SCHEMA_INVALID");
  assert.equal(await errorCode(() =>
    planWorkflow({ problemText: "ok", capabilityIds: ["opt.numerical"] })), "PLAN_INPUT_INVALID");
  assert.equal(await errorCode(() => planWorkflow({ problemText: "   " })), "PLAN_INPUT_INVALID");
  assert.equal(await errorCode(() => planWorkflow(/** @type {any} */ ("ok"))), "PLAN_SCHEMA_INVALID");
  // explicit smtLib override replaces the verbatim canonical text
  const overridden = await planWorkflow({ problemText: "prose is fine when smtLib overrides it", smtLib: SMT_PROBLEM });
  assert.equal((/** @type {any} */ (overridden.plan.steps[0].input)).smt_lib, SMT_PROBLEM);
});

test("V4b SDK: compileWorkflowPlan roundtrip chains hashes and is deterministic", async () => {
  const { plan } = await planWorkflow({ problemText: SMT_PROBLEM });
  const before = structuredClone(plan);
  const first = compileWorkflowPlan(plan);
  const second = compileWorkflowPlan(plan);
  assert.deepEqual(plan, before, "planWorkflow result is never mutated by compilation");
  assert.equal(first.launcher, second.launcher);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.schema, "formal-tools/launcher-manifest/1.0");
  assert.equal(first.manifest.plan_sha256, sha256Canonical(plan));
  assert.equal(first.plan.compiled.launcher_sha256, first.manifest.launcher_sha256);
  assert.ok(first.launcher.includes("// plan_id: " + plan.plan_id));
});

test("V4b SDK: executeWorkflowPlan fails closed binary-less with a BLOCKED ABORTED receipt", async () => {
  const { plan } = await planWorkflow({ problemText: SMT_PROBLEM });
  const calls = { n: 0 };
  await assert.rejects(
    executeWorkflowPlan(plan, { env: scrubEnv() }),
    e => {
      assert.ok(e instanceof WorkflowBlockedError, "expected WorkflowBlockedError, got " + String(e));
      assert.equal(e.code, "BLOCKED_TOOL_MISSING");
      assert.equal(e.receipt.overall.process_outcome, "ABORTED");
      assert.equal(e.receipt.overall.claim_verdict, "BLOCKED");
      assert.equal(e.receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
      assert.ok(e.receipt.steps.every(s => s.status === "NOT_RUN"));
      calls.n++;
      return true;
    });
  assert.equal(calls.n, 1);
});

test("V4b SDK/CLI: provider 'deepseek' without DEEPSEEK_API_KEY fails closed (BLOCKED_PROVIDER, no mock)", () => {
  const probe = [
    "const sdk = await import(" + JSON.stringify(new URL("../packages/runner/js/sdk.mjs", import.meta.url).href) + ");",
    "try {",
    "  await sdk.planWorkflow({ problemText: 'ok', provider: 'deepseek' });",
    "  console.log('UNEXPECTED_SUCCESS');",
    "  process.exit(1);",
    "} catch (e) {",
    "  console.log(e && e.code ? e.code : 'NO_CODE:' + String(e));",
    "  process.exit(e && e.code === 'BLOCKED_PROVIDER' ? 0 : 2);",
    "}"
  ].join("\n");
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    env: scrubEnv(), encoding: "utf8", cwd: repoRoot, timeout: 60000
  });
  assert.equal(run.status, 0, "stderr=" + run.stderr + " stdout=" + run.stdout);
  assert.equal(run.stdout.trim(), "BLOCKED_PROVIDER");
});

// ---------- CLI subprocess coverage ----------

test("V4b CLI: workflow plan prints a valid execution-plan JSON to stdout", () => {
  const tmp = makeTmp("cliplan");
  try {
    const problemFile = join(tmp, "problem.smt2");
    writeFileSync(problemFile, SMT_PROBLEM);
    const run = spawnSync(process.execPath, [cliPath, "workflow", "plan",
      "--problem-file", problemFile, "--assumption", "solvers run locally"], {
      cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 120000
    });
    assert.equal(run.status, 0, "stderr=" + run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.artifacts, null);
    assert.equal(out.plan.schema, "formal-tools/execution-plan/1.0");
    assert.match(out.plan.plan_id, /^wf-[a-f0-9]{32}$/);
    assert.equal(out.plan.steps.length, 3);
    assert.deepEqual(out.plan.steps.map(s => s.tool), ["z3", "cvc5", "compare"]);
    for (const step of out.plan.steps)
      assert.match(step.input_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(out.plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("V4b CLI: workflow plan --compile writes launcher+manifest+plan under artifacts/<plan_id>/", () => {
  const tmp = makeTmp("clicompile");
  try {
    const problemFile = join(tmp, "problem.smt2");
    writeFileSync(problemFile, SMT_PROBLEM);
    const run = spawnSync(process.execPath, [cliPath, "workflow", "plan",
      "--problem-file", problemFile, "--compile"], {
      cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 120000
    });
    assert.equal(run.status, 0, "stderr=" + run.stderr);
    const out = JSON.parse(run.stdout);
    assert.ok(out.artifacts && typeof out.artifacts.dir === "string");
    assert.ok(existsSync(out.artifacts.plan), out.artifacts.plan);
    assert.ok(existsSync(out.artifacts.launcher), out.artifacts.launcher);
    assert.ok(existsSync(out.artifacts.manifest), out.artifacts.manifest);
    const persisted = JSON.parse(readFileSync(out.artifacts.plan, "utf8"));
    assert.equal(persisted.plan_id, out.plan.plan_id);
    assert.equal(persisted.compiled.launcher_sha256, out.plan.compiled.launcher_sha256);
    assert.ok(readFileSync(out.artifacts.launcher, "utf8").includes(out.plan.plan_id));
    const manifest = JSON.parse(readFileSync(out.artifacts.manifest, "utf8"));
    assert.equal(manifest.plan_id, out.plan.plan_id);
    assert.equal(manifest.launcher_sha256, out.plan.compiled.launcher_sha256);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("V4b CLI: workflow execute without binaries writes an honest BLOCKED_TOOL_MISSING receipt (non-zero exit)", async () => {
  const tmp = makeTmp("cliexec");
  try {
    const { plan } = await planWorkflow({ problemText: SMT_PROBLEM });
    const planFile = join(tmp, "plan.json");
    writeFileSync(planFile, JSON.stringify(plan, null, 2));
    const run = spawnSync(process.execPath, [cliPath, "workflow", "execute",
      "--plan-file", planFile, "--source-sha", "f2b6a8df2b6a8df2b6a8df2b6a8df2b6a8df2b6a"], {
      cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 120000
    });
    assert.equal(run.status, 2, "fail-closed execution must exit non-zero, stderr=" + run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.blocked, "BLOCKED_TOOL_MISSING");
    assert.equal(summary.overall.process_outcome, "ABORTED");
    assert.equal(summary.overall.claim_verdict, "BLOCKED");
    assert.equal(summary.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
    assert.equal(summary.source_sha, "f2b6a8df2b6a8df2b6a8df2b6a8df2b6a8df2b6a");
    assert.ok(summary.receipt_path.startsWith(tmp), summary.receipt_path);
    assert.ok(existsSync(summary.receipt_path), "receipt must be persisted");
    const receipt = JSON.parse(readFileSync(summary.receipt_path, "utf8"));
    assert.equal(receipt.schema, "formal-tools/execution-receipt/1.0");
    assert.equal(receipt.plan_id, plan.plan_id);
    assert.equal(receipt.overall.claim_verdict, "BLOCKED");
    assert.equal(receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
    assert.ok(receipt.steps.every(s => s.status === "NOT_RUN"));

    // workflow results reports the verdict classes of the persisted receipt
    const res = spawnSync(process.execPath, [cliPath, "workflow", "results",
      "--receipt", summary.receipt_path], {
      cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 120000
    });
    assert.equal(res.status, 0, "results is a reporting command: stderr=" + res.stderr);
    const report = JSON.parse(res.stdout);
    assert.equal(report.schema, "formal-tools/execution-receipt/1.0");
    assert.ok(["OK", "PARTIAL", "FAILED", "ABORTED"].includes(report.overall.process_outcome));
    assert.ok(["PASS", "UNSUPPORTED_BY_MVP", "NOT_APPLICABLE", "BLOCKED"].includes(report.overall.claim_verdict));
    assert.ok(["AGREE_SAT", "AGREE_UNSAT", "CONTRADICTION", "UNKNOWN", "NOT_APPLICABLE"].includes(report.overall.cross_tool_verdict));
    assert.equal(report.overall.claim_verdict, "BLOCKED");

    // malformed receipts fail closed
    writeFileSync(join(tmp, "bad.json"), "{ not a receipt }");
    const bad = spawnSync(process.execPath, [cliPath, "workflow", "results",
      "--receipt", join(tmp, "bad.json")], {
      cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 120000
    });
    assert.equal(bad.status, 2);
    const parsedError = JSON.parse(bad.stderr);
    assert.equal(parsedError.status, "ERROR");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("V4b CLI: workflow usage errors exit 2 with machine-readable stderr", () => {
  const tmp = makeTmp("cliusage");
  try {
    const cases = /** @type {[string[], RegExp][]} */ ([
      [["workflow", "plan"], /--problem-file/],
      [["workflow", "plan", "--problem-file", join(tmp, "missing.smt2")], /no such file|ENOENT/i],
      [["workflow", "plan", "--problem-file", join(tmp, "p.txt"), "--provider", "anthropic"], /--provider must be 'deepseek'/],
      [["workflow", "plan", "--problem-file", join(tmp, "p.txt"), "--bogus", "x"], /unknown workflow option/],
      [["workflow", "execute"], /--plan-file/],
      [["workflow", "execute", "--plan-file", join(tmp, "p.txt"), "--source-sha", "nothex"], /--source-sha must be a 40-hex/],
      [["workflow", "results"], /--receipt/],
      [["workflow", "nonsense"], /workflow usage/]
    ]);
    writeFileSync(join(tmp, "p.txt"), "irrelevant");
    for (const [argv, pattern] of cases) {
      const run = spawnSync(process.execPath, [cliPath, ...argv], {
        cwd: tmp, encoding: "utf8", env: scrubEnv(), timeout: 60000
      });
      assert.equal(run.status, 2, "argv=" + argv.join(" ") + " stderr=" + run.stderr);
      const err = JSON.parse(run.stderr);
      assert.equal(err.status, "ERROR");
      assert.match(err.message, pattern);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- MCP stdio coverage (real child process, JSON-RPC over stdio) ----------

test("V4b+R2B MCP: real stdio server lists 16 tools; plans without executing; execute_workflow fails closed honestly", async () => {
  const child = spawn(process.execPath, [mcpPath], {
    stdio: ["pipe", "pipe", "pipe"], env: scrubEnv()
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", () => { /* diagnostics only */ });
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const request = (method, params, timeoutMs = 20000) => new Promise((ok, fail) => {
    const id = nextId++;
    const timer = setTimeout(() => fail(new Error("timeout waiting for " + method)), timeoutMs);
    pending.set(id, msg => { clearTimeout(timer); ok(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const firstText = result => {
    const block = result?.content?.find(b => b.type === "text");
    if (!block) return undefined;
    try { return JSON.parse(block.text); } catch { return block.text; }
  };
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "wf-v4b-test", version: "1.0.0" }
    });
    assert.equal(init.result?.serverInfo?.name, "formal-tools-skill");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    const list = await request("tools/list", {});
    const names = (list.result?.tools ?? []).map(t => t.name).sort();
    assert.equal(names.length, 16);
    assert.ok(names.includes("plan_workflow"), "tools/list must include plan_workflow");
    assert.ok(names.includes("execute_workflow"), "tools/list must include execute_workflow (R2-B)");
    const schema = JSON.stringify(list.result.tools.find(t => t.name === "plan_workflow").inputSchema);
    assert.match(schema, /problem_text/);
    assert.doesNotMatch(schema, /argv|shell|command|cwd|execute/);
    const execSchema = JSON.stringify(list.result.tools.find(t => t.name === "execute_workflow").inputSchema);
    assert.match(execSchema, /plan/);
    assert.match(execSchema, /source_sha/);
    assert.doesNotMatch(execSchema, /"argv"|"shell"|"command"|"cwd"|"file_path"/);

    const call = async (name, args) => request("tools/call", { name, arguments: args });
    const ok = await call("plan_workflow", { problem_text: SMT_PROBLEM, assumptions: ["bounded"] });
    const plan = firstText(ok.result);
    assert.equal(ok.result?.isError, undefined);
    assert.equal(plan?.schema, "formal-tools/execution-plan/1.0");
    assert.equal(plan?.tool_execution, "NOT_RUN");
    assert.deepEqual(plan?.steps.map(s => s.tool), ["z3", "cvc5", "compare"]);
    assert.equal(plan?.compiled?.launcher_sha256, null);

    const empty = await call("plan_workflow", { problem_text: "" });
    assert.equal(empty.result?.isError, true, "empty problem_text must be rejected");
    const badProvider = await call("plan_workflow", { problem_text: "ok", provider: "echo" });
    assert.equal(badProvider.result?.isError, true, "unknown provider must be rejected");
    const extra = await call("plan_workflow", { problem_text: "ok", argv: ["sh"] });
    assert.equal(extra.result?.isError, true, "execution-shaped arguments must be rejected by .strict()");

    // i180/R2-B: execute_workflow over stdio, binary-less environment — the
    // executor preflight fails closed and the tool returns the honest ABORTED
    // receipt as a NON-error result; tampering is a pre-execution tool error.
    const executionPlan = (({ schema, plan_id, source, assumptions, method_dag, budgets, compiled, steps }) =>
      ({ schema, plan_id, source, assumptions, method_dag, budgets, compiled, steps }))(plan);
    const exec = await call("execute_workflow", { plan: executionPlan, source_sha: "f2b6a8df2b6a8df2b6a8df2b6a8df2b6a8df2b6a" });
    const receiptView = firstText(exec.result);
    assert.equal(exec.result?.isError, undefined, "honest fail-closed receipts are non-error results");
    assert.equal(receiptView?.status, "FAIL_CLOSED_RECEIPT_RETURNED");
    assert.equal(receiptView?.execution, "REAL_WORKFLOW_EXECUTOR");
    assert.equal(receiptView?.executed, false);
    assert.equal(receiptView?.blocked_code, "BLOCKED_TOOL_MISSING");
    assert.equal(receiptView?.schema, "formal-tools/execution-receipt/1.0");
    assert.equal(receiptView?.overall?.process_outcome, "ABORTED");
    assert.equal(receiptView?.overall?.claim_verdict, "BLOCKED");
    assert.equal(receiptView?.overall?.fail_closed_reason, "BLOCKED_TOOL_MISSING");
    assert.deepEqual(receiptView?.steps?.map(s => s.status), ["NOT_RUN", "NOT_RUN", "NOT_RUN"]);
    assert.match(String(receiptView?.artifact_manifest?.receipt_sha256), /^[a-f0-9]{64}$/);
    const tampered = structuredClone(executionPlan);
    tampered.steps[0].input_sha256 = "0".repeat(64);
    const tamperCall = await call("execute_workflow", { plan: tampered, source_sha: "f2b6a8df2b6a8df2b6a8df2b6a8df2b6a8df2b6a" });
    assert.equal(tamperCall.result?.isError, true, "hash tampering must be a tool error");
    assert.equal(firstText(tamperCall.result)?.code, "PLAN_HASH_MISMATCH");
    const noSha = await call("execute_workflow", { plan: executionPlan });
    assert.equal(noSha.result?.isError, true, "source_sha is required (no anonymous runs)");
    const argvExec = await call("execute_workflow", { plan: executionPlan, source_sha: "f2b6a8df2b6a8df2b6a8df2b6a8df2b6a8df2b6a", argv: ["sh"] });
    assert.equal(argvExec.result?.isError, true, "execution-shaped arguments must be rejected by .strict()");
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise(ok => { const t = setTimeout(ok, 1000); child.once("exit", () => { clearTimeout(t); ok(); }); });
  }
});

// ---------- real DeepSeek provider path (skipped without env key) ----------

const DEEPSEEK_PROBLEM =
  "Check with two independent SMT solvers (z3 and cvc5) whether this bounded integer problem is unsat: " +
  "x and y are integers with 0 <= x <= 9, 0 <= y <= 9, x*x + y*y = 65 and x - y = 1. " +
  "Both solvers must agree on the sat/unsat answer.";

test("V4b SDK real DeepSeek: provider:'deepseek' proposes the method and plans it", { timeout: 240000 }, async t => {
  if (!process.env.DEEPSEEK_API_KEY) {
    t.skip("BLOCKED_PROVIDER: DEEPSEEK_API_KEY not set (CI skips; never mocked)");
    return;
  }
  // A chatty model may occasionally emit a proposal that fails admission;
  // each retry is a fresh real call (single-attempt API, caller retries).
  let last = null;
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 2 && !last; attempt++) {
    try {
      last = await planWorkflow({
        problemText: DEEPSEEK_PROBLEM,
        assumptions: ["input is bounded linear integer arithmetic", "solvers run locally"],
        provider: "deepseek"
      });
    } catch (e) {
      if (e instanceof WorkflowError && e.code === "PLAN_METHOD_INVALID" && attempt < 2) continue;
      throw e;
    }
  }
  assert.ok(last, "planWorkflow deepseek path must produce a plan");
  assert.ok(Date.now() - t0 > 250, "a real provider round trip must take network time, not instant-mock time");
  const tools = last.plan.steps.map(s => s.tool);
  assert.ok(tools.includes("z3") && tools.includes("cvc5"), "two independent solvers required: " + tools.join(","));
  assert.deepEqual(last.plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  assert.equal(last.plan.source.problem_kind, "user_problem");
  console.log("DEEPSEEK_REAL_CALL via SDK planWorkflow model=%s plan_id=%s steps=%s execution=NOT_RUN",
    "deepseek-chat", last.plan.plan_id, tools.join("+"));
});

test("V4b: executor rejects tampered plans before anything runs (WorkflowPlanError, not a crash)", async () => {
  const { plan } = await planWorkflow({ problemText: SMT_PROBLEM });
  const tampered = structuredClone(plan);
  tampered.steps[0].input_sha256 = "0".repeat(64);
  await assert.rejects(
    executeWorkflowPlan(tampered, { env: scrubEnv() }),
    e => e instanceof WorkflowPlanError && e.code === "PLAN_HASH_MISMATCH");
});
