#!/usr/bin/env node
/**
 * mvp-user-e2e LIVE MCP journey driver (issue #186, V6 @ 646859f).
 *
 * Runs on the host with the bundled node + node_modules present. Spawns
 * packages/runner/js/mcp.mjs as a REAL child and speaks newline-delimited
 * JSON-RPC over stdio (initialize -> tools/list -> tools/call) — the same
 * transport an external MCP host uses. Assertions:
 *   - tools/list exposes EXACTLY the 15 registered tools incl plan_workflow;
 *   - plan_workflow with the scenario-A SMT2 problem (DETERMINISTIC provider —
 *     the real-LLM requirement is covered by the CLI/Web journeys, recorded
 *     here as planner:"deterministic-template") returns a valid
 *     formal-tools/execution-plan/1.0;
 *   - the SAME call replays to the SAME plan_id (no hidden randomness);
 *   - provider:"deepseek" without a key fails closed with BLOCKED_PROVIDER
 *     (proving the provider lane is real, never mocked);
 *   - the returned plan is compared to the CLI template-parity plan (J6):
 *     identical plan object => identical plan_id/plan_sha256.
 *
 * Exit codes: 0 all assertions hold, 2 mismatch, 5 harness error.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpClient, EXPECTED_MCP_TOOLS } from "./run-mcp.mjs";
import { validateExecutionPlanShape } from "./lib.mjs";

const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");
const FX = join(REPO_ROOT, "validation", "mvp-user-e2e", "fixtures");

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT_DIR = resolve(process.cwd(), arg("--out", "validation/mvp-user-e2e/evidence/live-mcp"));
const CLI_PLAN_FILE = arg("--cli-plan", join(REPO_ROOT, "validation/mvp-user-e2e/evidence/live-cli/j6-template-parity/plan.json"));

const SAT_ASSUMPTIONS = [
  "Input is UTF-8 SMT-LIB2 text intended for QF-style solving.",
  "Solvers may return \"unknown\" within the per-step timeout; that is an honest outcome, not an error."
];

const findings = [];
const check = (name, pass, detail = "") => {
  findings.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}\n`);
};

const firstText = (result) => {
  const block = result?.content?.find((b) => b.type === "text");
  if (!block) return undefined;
  try { return JSON.parse(block.text); } catch { return block.text; }
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const smtText = await readFile(join(FX, "scenario-a.smt2"), "utf8");
  const client = startMcpClient({ timeoutMs: 30000 });
  let plan = null;
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "formal-mvp-user-e2e-live", version: "1.0.0" }
    });
    check("initialize handshake", init.result?.serverInfo?.name === "formal-tools-skill",
      JSON.stringify(init.result?.serverInfo));
    client.notify("notifications/initialized");

    const list = await client.request("tools/list", {});
    const names = (list.result?.tools ?? []).map((t) => t.name).sort();
    check("tools/list exposes exactly the 15 registered tools",
      JSON.stringify(names) === JSON.stringify(EXPECTED_MCP_TOOLS), names.join(","));
    check("plan_workflow is registered", names.includes("plan_workflow"));

    // DETERMINISTIC plan (the real-LLM journeys live in live-cli/live-web evidence).
    const wf = await client.call("plan_workflow", {
      problem_text: smtText, assumptions: SAT_ASSUMPTIONS
    }, 60000);
    plan = firstText(wf.resp.result);
    check("plan_workflow returns an execution-plan/1.0",
      wf.result?.isError !== true && plan?.schema === "formal-tools/execution-plan/1.0",
      JSON.stringify({ plan_id: plan?.plan_id, steps: plan?.steps?.map((s) => s.tool) }));
    if (plan?.schema === "formal-tools/execution-plan/1.0") {
      // The plan_workflow tool wraps the plan with two DECLARED extra keys
      // (problem_id echo + tool_execution:"NOT_RUN"); validate the plan core.
      const planCore = { ...plan };
      delete planCore.problem_id;
      delete planCore.tool_execution;
      const shape = validateExecutionPlanShape(planCore);
      check("returned plan conforms to the pinned V3 shape (after removing the two declared wrapper keys)",
        shape.ok && shape.classes.length === 0, JSON.stringify({ errors: shape.errors, classes: shape.classes }));
      check("plan carries null compiled hashes (planning-only over MCP)",
        plan.compiled?.launcher_sha256 === null && plan.compiled?.manifest_sha256 === null,
        JSON.stringify(plan.compiled));
      check("plan declares tool_execution NOT_RUN (MCP never executes)",
        plan.tool_execution === "NOT_RUN", String(plan.tool_execution));
    }

    // Determinism replay.
    const wf2 = await client.call("plan_workflow", {
      problem_text: smtText, assumptions: SAT_ASSUMPTIONS
    }, 60000);
    const plan2 = firstText(wf2.resp.result);
    check("plan_workflow is deterministic (same input -> same plan_id)",
      plan2?.plan_id === plan?.plan_id, JSON.stringify({ first: plan?.plan_id, second: plan2?.plan_id }));

    // Real-provider probe on THIS child (it inherited the spawn-time env, key included if present).
    const firstClient = await client.call("plan_workflow", {
      problem_text: smtText, assumptions: SAT_ASSUMPTIONS, provider: "deepseek"
    }, 120000);
    const deepseekPlan = firstText(firstClient.resp.result);
    if (process.env.DEEPSEEK_API_KEY) {
      // Child had the key: a REAL DeepSeek proposal is expected.
      const realPlan = firstClient.isError !== true && deepseekPlan?.schema === "formal-tools/execution-plan/1.0";
      check("plan_workflow with provider:'deepseek' returns a real LLM-planned execution-plan/1.0",
        realPlan, JSON.stringify({ plan_id: deepseekPlan?.plan_id ?? deepseekPlan, blocked: deepseekPlan?.blocked ?? null }));
      check("DeepSeek proposal reproduces the CLI DeepSeek journey's plan (temperature-0 determinism across entries)",
        deepseekPlan?.plan_id === "wf-1023fdabe42c64cbc0d5677766aa925f",
        JSON.stringify({ mcp_deepseek_plan_id: deepseekPlan?.plan_id ?? null, cli_deepseek_plan_id: "wf-1023fdabe42c64cbc0d5677766aa925f" }));
    } else {
      check("plan_workflow with provider:'deepseek' fails closed without a key (no key on this host)",
        firstClient.isError === true && /BLOCKED_PROVIDER/.test(JSON.stringify(deepseekPlan)),
        JSON.stringify(deepseekPlan).slice(0, 200));
    }

    // Dedicated BLOCKED_PROVIDER probe: a SECOND MCP child spawned with the key stripped.
    const savedKey = process.env.DEEPSEEK_API_KEY;
    if (savedKey) delete process.env.DEEPSEEK_API_KEY;
    const noKeyClient = startMcpClient({ timeoutMs: 30000 });
    let blockedOk = false, blockedDetail = "";
    try {
      await noKeyClient.request("initialize", {
        protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "formal-mvp-user-e2e-live-nokey", version: "1.0.0" }
      });
      noKeyClient.notify("notifications/initialized");
      const blockedCall = await noKeyClient.call("plan_workflow", {
        problem_text: smtText, assumptions: SAT_ASSUMPTIONS, provider: "deepseek"
      }, 30000);
      const blocked = firstText(blockedCall.resp.result);
      // handle() wraps the thrown WorkflowError (code BLOCKED_PROVIDER) as
      // {status:"ERROR", message:"WorkflowError: ...requires DEEPSEEK_API_KEY..."}.
      blockedOk = blockedCall.isError === true &&
        /requires DEEPSEEK_API_KEY|BLOCKED_PROVIDER/.test(JSON.stringify(blocked));
      blockedDetail = JSON.stringify(blocked).slice(0, 200);
    } catch (e) {
      blockedDetail = String(e).slice(0, 200);
    } finally {
      await noKeyClient.close();
      if (savedKey) process.env.DEEPSEEK_API_KEY = savedKey;
    }
    check("provider:'deepseek' without a key fails closed with BLOCKED_PROVIDER (never mocked)",
      blockedOk, blockedDetail);

    // Cross-entry parity: same problem + assumptions through the CLI planner
    // must produce the IDENTICAL plan object (same plan_id => same plan_sha256).
    try {
      const cliPlan = JSON.parse(await readFile(CLI_PLAN_FILE, "utf8"));
      check("CLI and MCP planners agree on the identical plan object (same plan_id)",
        cliPlan?.plan_id === plan?.plan_id,
        JSON.stringify({ cli: cliPlan?.plan_id, mcp: plan?.plan_id }));
    } catch (e) {
      check("CLI template-parity plan available for comparison", false, String(e).slice(0, 160));
    }
  } catch (e) {
    check("driver completed without exception", false, String(e).slice(0, 300));
  } finally {
    await client.close();
  }

  const transcript = client.transcript;
  const redacted = JSON.stringify(transcript);
  await writeFile(join(OUT_DIR, "transcript.json"),
    JSON.stringify({ schema: "formal-tools/user-e2e-mcp-transcript/1.0", generated_at: new Date().toISOString(),
      planner: "deterministic-template (plan_workflow default provider)",
      assertions: findings, transcript }, null, 2) + "\n", "utf8");
  if (plan) await writeFile(join(OUT_DIR, "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");
  const passed = findings.every((f) => f.pass);
  const summary = {
    schema: "formal-tools/user-e2e-live-mcp/1.0",
    generated_at: new Date().toISOString(),
    planner: "deterministic-template",
    assertions: findings,
    summary: { checks: findings.length, passed: findings.filter((f) => f.pass).length, failed: findings.filter((f) => !f.pass).length },
    plan_id: plan?.plan_id ?? null,
    // never echo credential material into the receipt
    credential_material_present: /sk-[A-Za-z0-9]{20,}/.test(redacted)
  };
  await writeFile(join(OUT_DIR, "mcp-journey.report.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  process.stdout.write(`receipt: ${join(OUT_DIR, "mcp-journey.report.json")} — ${summary.summary.passed}/${summary.summary.checks} checks passed\n`);
  return passed ? 0 : 2;
}

try {
  process.exitCode = await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1000) }) + "\n");
  process.exit(5);
}
