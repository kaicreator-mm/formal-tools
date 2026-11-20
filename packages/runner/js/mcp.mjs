/**
 * Formal Tool Runner MCP via official TypeScript SDK v2.
 * Requires npm install; local stdio only. stdout reserved for MCP protocol.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyPure } from "../../core/src/finite.mjs";
import { knownTools, validateSource, inspectTool, doctor, runFixture } from "./native.mjs";
import { describeNativeTool, planNative, toolIds } from "./native-catalog.mjs";
import { inspectInstallation } from "./tool-manager.mjs";
import { listPortfolioTools, describePortfolioTool, inspectPortfolioTool, runPortableGate, runPortfolioOperation } from "./tool-portfolio-t4.mjs";
import { matchValidatedTools, loadCapabilityValidation } from "./capability-validation.mjs";
import { planWorkflow } from "./sdk.mjs";
import {
  executeWorkflowPlan, validateExecutionPlan,
  WorkflowPlanError, WorkflowBlockedError
} from "./workflow-executor.mjs";
import { writeExecutionReceiptArtifacts } from "./workflow-evidence.mjs";

// ---- i180/R2-B: bounded typed execution surface (16th tool) ----------------
// execute_workflow delegates to the real V3 DAG executor (executeWorkflowPlan).
// Plan re-validation, allowlist, hash binding and budgets stay THE EXECUTOR'S
// choke points; this layer only bounds the transport (64 KiB plan JSON),
// requires a labeled source_sha (no anonymous runs) and bounds the response.
const EXECUTE_MAX_PLAN_BYTES = 65536;
const EXECUTE_RESPONSE_STEP_LOG_BYTES = 512;
const EXECUTE_RESPONSE_MAX_ARTIFACTS = 256;
const SHA256_HEX = z.string().regex(/^[a-f0-9]{64}$/, "must be 64 lowercase hex digits");
const executeStepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
  tool: z.enum(["z3", "cvc5", "highs", "compare"]),
  operation: z.enum(["solve-smt", "solve-lp", "cross-check"]),
  depends_on: z.array(z.string().min(1).max(64)).max(64),
  input: z.unknown(),
  input_sha256: SHA256_HEX,
  timeout_s: z.number().int().min(1).max(120),
  expected_output_kind: z.enum(["smt-answer", "lp-status", "cross-tool-verdict"])
}).strict();
const executePlanSchema = z.object({
  schema: z.literal("formal-tools/execution-plan/1.0"),
  plan_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/),
  source: z.object({
    problem_sha256: SHA256_HEX,
    problem_kind: z.string().min(1).max(64)
  }).strict(),
  assumptions: z.array(z.string().max(256)).max(32),
  method_dag: z.array(z.object({
    id: z.string().max(64),
    kind: z.string().max(64),
    depends_on: z.array(z.string().max(64))
  }).strict()).max(64),
  budgets: z.object({
    max_steps: z.number().int().min(1).max(1024),
    max_total_timeout_s: z.number().int().min(1).max(86400)
  }).strict(),
  compiled: z.object({
    launcher_sha256: SHA256_HEX.nullable(),
    manifest_sha256: SHA256_HEX.nullable()
  }).strict(),
  steps: z.array(executeStepSchema).min(1).max(1024)
}).strict();
const clipBounded = (text, limit) => {
  if (typeof text !== "string") return null;
  if (Buffer.byteLength(text, "utf8") <= limit) return {text, truncated: false};
  return {text: Buffer.from(text, "utf8").subarray(0, limit).toString("utf8"), truncated: true};
};
const executeStepView = step => {
  const out = clipBounded(step.stdout_bounded, EXECUTE_RESPONSE_STEP_LOG_BYTES);
  const err = clipBounded(step.stderr_bounded, EXECUTE_RESPONSE_STEP_LOG_BYTES);
  const artifacts = Array.isArray(step.artifacts) ? step.artifacts : [];
  return {
    step_id: step.step_id, tool: step.tool, operation: step.operation,
    status: step.status, exit_code: step.exit_code, elapsed_ms: step.elapsed_ms,
    stdout_sha256: step.stdout_sha256, stderr_sha256: step.stderr_sha256,
    stdout_bounded: out === null ? null : out.text,
    stdout_truncated: out === null ? false : out.truncated,
    stderr_bounded: err === null ? null : err.text,
    stderr_truncated: err === null ? false : err.truncated,
    result: step.result,
    artifact_count: artifacts.length,
    artifacts: artifacts.slice(0, 8).map(a => ({name: a.name, sha256: a.sha256, bytes: a.bytes})),
    artifacts_truncated: artifacts.length > 8
  };
};
/** Tighten-only admission caps: never extend the plan budgets (the executor
 * re-enforces its own budgets; caps are an extra MCP-boundary admission gate). */
function applyBudgetCaps(plan, budgetCaps) {
  if (!budgetCaps) return;
  if (budgetCaps.max_steps !== undefined) {
    if (budgetCaps.max_steps > plan.budgets.max_steps)
      throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED",
        "budget_caps.max_steps=" + budgetCaps.max_steps + " exceeds the plan budget " +
        plan.budgets.max_steps + "; budget_caps may only tighten, never extend");
    if (plan.steps.length > budgetCaps.max_steps)
      throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED",
        "plan has " + plan.steps.length + " steps; budget_caps.max_steps=" + budgetCaps.max_steps);
  }
  if (budgetCaps.max_total_timeout_s !== undefined) {
    if (budgetCaps.max_total_timeout_s > plan.budgets.max_total_timeout_s)
      throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED",
        "budget_caps.max_total_timeout_s=" + budgetCaps.max_total_timeout_s + " exceeds the plan budget " +
        plan.budgets.max_total_timeout_s + "; budget_caps may only tighten, never extend");
    const total = plan.steps.reduce((sum, s) => sum + s.timeout_s, 0);
    if (total > budgetCaps.max_total_timeout_s)
      throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED",
        "plan step timeouts sum to " + total + "s; budget_caps.max_total_timeout_s=" +
        budgetCaps.max_total_timeout_s);
  }
}
async function readArtifactManifest(workspaceDir) {
  if (typeof workspaceDir !== "string" || !workspaceDir) return null;
  try {
    const parsed = JSON.parse(await readFile(join(workspaceDir, "manifest.json"), "utf8"));
    if (!parsed || parsed.schema !== "formal-tools/execution-artifacts/1.0") return null;
    const entries = Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
    return {
      receipt_sha256: parsed.receipt_sha256 ?? null,
      artifacts: entries.slice(0, EXECUTE_RESPONSE_MAX_ARTIFACTS)
        .map(a => ({name: a.name, sha256: a.sha256, bytes: a.bytes})),
      artifacts_truncated: entries.length > EXECUTE_RESPONSE_MAX_ARTIFACTS
    };
  } catch { return null; }
}
const executeResponse = (receipt, {executed, blockedCode, workspaceDir, artifactManifest}) => ({
  status: executed ? "EXECUTION_RECEIPT_RETURNED" : "FAIL_CLOSED_RECEIPT_RETURNED",
  execution: "REAL_WORKFLOW_EXECUTOR",
  schema: receipt.schema,
  run_id: receipt.run_id,
  plan_id: receipt.plan_id,
  plan_sha256: receipt.plan_sha256,
  source_sha: receipt.source_sha ?? null,
  created_at: receipt.created_at,
  executed,
  blocked_code: blockedCode,
  overall: receipt.overall,
  tool_versions: receipt.tool_versions,
  environment: receipt.environment,
  steps: receipt.steps.map(executeStepView),
  artifact_manifest: artifactManifest,
  workspace_dir: typeof workspaceDir === "string" ? workspaceDir : null,
  response_bounds: {
    step_log_bytes: EXECUTE_RESPONSE_STEP_LOG_BYTES,
    max_artifact_pointers: EXECUTE_RESPONSE_MAX_ARTIFACTS
  }
});

/** @typedef {{type:"text",text:string}} TextBlock */
/** @type {(x:unknown)=>{content:TextBlock[]}} */
const txt=x=>({content:[{type:"text",text:JSON.stringify(x)}]});
/** @type {(callback: ()=>unknown)=>Promise<{content:TextBlock[],isError?:boolean}>} */
const handle=async callback=>{
  try{return txt(await callback());}
  catch(e){return {content:[{type:"text",text:JSON.stringify({status:"ERROR",message:String(e)})}],isError:true};}
};
const candidateId=z.string().refine(value=>listPortfolioTools().some(t=>t.id===value&&t.origin==="candidate"),
  {message:"Unknown candidate tool or existing native tool; use the original native adapter"});
const portfolioId=z.string().refine(value=>listPortfolioTools().some(t=>t.id===value),
  {message:"Unknown portfolio tool"});
const toolId=z.string().refine(value=>toolIds.includes(value),{message:"Unknown registered formal tool"});
const highsModelSchema=z.object({
  sense:z.enum(["min","max"]),
  objective:z.array(z.number().finite()).min(1).max(64),
  variables:z.array(z.object({
    lower:z.number().finite().nullable(),upper:z.number().finite().nullable()
  }).strict()).min(1).max(64),
  constraints:z.array(z.object({
    lower:z.number().finite().nullable(),upper:z.number().finite().nullable(),
    coefficients:z.array(z.number().finite()).max(64)
  }).strict()).max(128)
}).strict();
serveStdio(()=>{
  const server=new McpServer({name:"formal-tools-skill",version:"0.0.1"});
  server.registerTool("list_formal_tools",{
    description:"List original 13 native adapters, 23 candidate portfolio tools, and 4 pure JS model checkers.",
    inputSchema:z.object({})
  },async()=>txt({native:knownTools(),portfolio:listPortfolioTools(),pure:["dag","writers","cnf","states"]}));
  server.registerTool("validate_formal_source",{
    description:"Validate Skill names and repository inputs; does NOT run proof engines.",
    inputSchema:z.object({})
  },async()=>handle(()=>validateSource()));
  server.registerTool("inspect_formal_tool",{
    description:"Describe registered native tool usage and positive/negative fixture expectations.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>inspectTool(tool)));
  server.registerTool("probe_formal_tool",{
    description:"Attempt a tool --version/--help via Node process, not a theorem proof.",
    inputSchema:z.object({tool:toolId,timeout_s:z.number().int().min(1).max(120).default(15)})
  },async({tool,timeout_s})=>handle(()=>doctor(tool,timeout_s)));
  server.registerTool("run_formal_fixture",{
    description:"Execute a fixed, committed tool fixture, not arbitrary shell or user code.",
    inputSchema:z.object({tool:toolId,case:z.enum(["positive","negative"]),timeout_s:z.number().int().min(1).max(120).default(30)})
  },async({tool,case:which,timeout_s})=>handle(()=>runFixture(tool,which,timeout_s)));
  server.registerTool("describe_native_cli",{
    description:"Describe a tool and its named CLI operations, without executing anything.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>describeNativeTool(tool)));
  server.registerTool("inspect_native_installation",{
    description:"Read-only installed executable/JAR discovery and missing dependency diagnostics. Does NOT launch native tools.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>inspectInstallation(tool)));
  server.registerTool("plan_native_cli",{
    description:"Validate native CLI option values, return planned argv; NO execution and NO raw passthrough.",
    inputSchema:z.object({tool:toolId,operation:z.string().min(1),settings:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({})})
  },async({tool,operation,settings})=>handle(()=>planNative(tool,operation,settings)));
  server.registerTool("list_portfolio_tools",{
    description:"Read-only capability and tool metadata for all 36 tools. Never implies a T3/T4/T5 PASS.",
    inputSchema:z.object({})
  },async()=>txt({tools:listPortfolioTools(),status:"DISCOVERY_NOT_T4_QUALIFIED"}));
  server.registerTool("match_formal_capabilities",{
    description:"Deterministic capability-ID to validated-tool match over the r176 container probe receipts. Read-only; capability IDs come from the frozen discovery registry. Probe receipts are technical evidence, never a T3/T4/T5/T6 or business acceptance.",
    inputSchema:z.object({
      capabilities:z.array(z.string().min(1)).min(1).max(16),
      include_not_verified:z.boolean().default(false)
    }).strict()
  },async({capabilities,include_not_verified})=>handle(async()=>{
    const match=matchValidatedTools(capabilities,{includeNotVerified:include_not_verified});
    const ledger=loadCapabilityValidation();
    return {...match,ledger_counts:ledger.counts,
      scope:"PROBE_RECEIPTS_ARE_TECHNICAL_EVIDENCE_ONLY_NOT_FORMAL_ACCEPTANCE"};
  }));
  server.registerTool("inspect_portfolio_tool",{
    description:"Read-only pinned portable installation metadata; no process launch.",
    inputSchema:z.object({tool:portfolioId})
  },async({tool})=>handle(()=>inspectPortfolioTool(tool)));
  server.registerTool("verify_portable_fixture",{
    description:"Run ONLY the candidate tool's committed portable pos/neg/err fixture through a SHA-pinned runner. No user input/raw argv/shell. Technical evidence only, not business verification.",
    inputSchema:z.object({tool:candidateId,timeout_s:z.number().int().min(1).max(120).default(120)})
  },async({tool,timeout_s})=>{
    const response=await handle(()=>runPortableGate(tool,{mode:"verify-fixture",timeoutS:timeout_s}));
    // A returned NOT_RUN/NOT_QUALIFIED is an MCP tool error, not a successful
    // native execution. Keep the technical receipt itself in the content.
    try{
      const receipt=JSON.parse(response.content[0]?.text??"{}");
      if(receipt.status!=="FIXTURE_TECHNICAL_PASS_UNREVIEWED")return {...response,isError:true};
    }catch{return {...response,isError:true};}
    return response;
  });
  server.registerTool("run_portfolio_operation",{
    description:"Run a registered typed candidate operation through the shared portfolio Runner. Currently only Highs 1.15.1 solve-lp is admitted; accepts a bounded LP model, never raw argv, shell, script path or arbitrary file input.",
    inputSchema:z.object({
      tool:z.literal("highs"),operation:z.literal("solve-lp"),model:highsModelSchema,
      timeout_s:z.number().int().min(1).max(30).default(30)
    }).strict()
  },async({tool,operation,model,timeout_s})=>{
    const response=await handle(()=>runPortfolioOperation(tool,operation,model,{timeoutS:timeout_s}));
    try{
      const receipt=JSON.parse(response.content[0]?.text??"{}");
      if(receipt.status!=="T4_OPERATION_EXECUTED_UNREVIEWED")return {...response,isError:true};
    }catch{return {...response,isError:true};}
    return response;
  });
  server.registerTool("verify_formal_model",{
    description:"Run real finite-model checks in pure JS: DAG, writer exclusivity, CNF or finite state.",
    inputSchema:z.object({engine:z.enum(["dag","writers","cnf","states"]),model:z.record(z.string(),z.unknown())})
  },async({engine,model})=>handle(()=>verifyPure(engine,model)));
  server.registerTool("plan_workflow",{
    description:"Plan a bounded user problem into a formal-tools/execution-plan/1.0 workflow (PLANNING ONLY - this tool never executes anything; tool_execution stays NOT_RUN; execution exists as the separate execute_workflow tool). Deterministic z3+cvc5 cross-check template by default; the canonical problem text is used verbatim as the SMT-LIB input of both solvers. Optional provider:'deepseek' replaces the template with ONE real DeepSeek method proposal using DEEPSEEK_API_KEY from the host environment (absent key fails closed with BLOCKED_PROVIDER; never mocked).",
    inputSchema:z.object({
      problem_text:z.string().min(1).max(65536),
      assumptions:z.array(z.string().max(512)).max(32).default([]),
      provider:z.enum(["deepseek"]).optional()
    }).strict()
  },async({problem_text,assumptions,provider})=>handle(async()=>{
    const {problem,plan}=await planWorkflow({problemText:problem_text,assumptions,provider});
    return {...plan,problem_id:problem.problem_id,tool_execution:"NOT_RUN"};
  }));
  server.registerTool("execute_workflow",{
    description:"Execute a formal-tools/execution-plan/1.0 plan through the real typed DAG executor on this trusted host (the same executor the CLI 'workflow execute' path uses). Bounded typed input: the plan object (<=64KiB JSON), a REQUIRED source_sha (40-hex git commit of the caller's source tree - no anonymous or unlabeled runs), and optional tighten-only budget_caps. Plan re-validation, tool allowlist, canonical input hashes, DAG closure and budgets are enforced by the executor itself (never duplicated or bypassed here); no raw shell, no argv passthrough, no file-path inputs, no tool escalation. The host environment must provide FORMAL_PORTABLE_ROOT pointing at the pinned portable bundle; env is inherited from the MCP server process. Returns the receipt's overall verdicts (process_outcome / solver_answer / cross_tool_verdict / claim_verdict - never collapsed), per-step statuses with stream hashes (bounded log copies further truncated to 512 bytes) and receipt artifact pointers. Without the pinned bundle the executor preflight fails closed and the tool returns the honest ABORTED receipt (claim_verdict BLOCKED, fail_closed_reason BLOCKED_TOOL_MISSING) as a NON-error result - never a fabricated PASS. Invalid plans (schema/hash/budget violations) are tool errors before anything runs.",
    inputSchema:z.object({
      plan:executePlanSchema,
      source_sha:z.string().regex(/^[a-f0-9]{40}$/,"must be a 40-hex git commit SHA"),
      budget_caps:z.object({
        max_steps:z.number().int().min(1).max(1024).optional(),
        max_total_timeout_s:z.number().int().min(1).max(86400).optional()
      }).strict().optional()
    }).strict()
  },async({plan,source_sha,budget_caps})=>{
    try{
      const planBytes=Buffer.byteLength(JSON.stringify(plan),"utf8");
      if(planBytes>EXECUTE_MAX_PLAN_BYTES)
        throw new WorkflowPlanError("PLAN_OVERSIZED",
          "plan JSON is "+planBytes+" bytes; execute_workflow accepts at most "+EXECUTE_MAX_PLAN_BYTES+" bytes");
      // Executor-owned re-validation first (throws WorkflowPlanError; nothing
      // runs, nothing is written on failure). The raw plan then feeds only the
      // tighten-only budget-caps admission check; executeWorkflowPlan
      // re-validates internally (defense in depth).
      validateExecutionPlan(plan);
      applyBudgetCaps(plan, budget_caps);
      let receipt,workspaceDir=null,blockedCode=null,executed=true;
      try{
        ({receipt,workspaceDir}=await executeWorkflowPlan(plan,{sourceSha:source_sha,env:process.env}));
      }catch(e){
        if(!(e instanceof WorkflowBlockedError)||!e.receipt)throw e;
        receipt=e.receipt;workspaceDir=e.workspaceDir;blockedCode=e.code;executed=false;
        // Persist the ABORTED receipt into the executor's own workspace so the
        // artifact pointers below resolve to real hash-bound files (mirrors the
        // CLI receipt.json write; the caller controls no paths).
        try{await writeExecutionReceiptArtifacts(workspaceDir,receipt,[]);}catch{}
      }
      const artifactManifest=await readArtifactManifest(workspaceDir);
      return txt(executeResponse(receipt,{executed,blockedCode,workspaceDir,artifactManifest}));
    }catch(e){
      if(e instanceof WorkflowPlanError)
        return {content:[{type:"text",text:JSON.stringify({status:"ERROR",executed:false,code:e.code,message:String(e.message)})}],isError:true};
      throw e;
    }
  });
  return server;
});
