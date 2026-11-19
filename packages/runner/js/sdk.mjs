/**
 * Experimental JS/TS tooling facade, independent of business model semantics.
 * This is a trusted Node host library, not an arbitrary command execution MCP.
 * It does not auto-install tools, fetch remote models, or choose tool strategies.
 */
import { toolIds, toolRuntimeProfile, planNative, describeNativeTool } from "./native-catalog.mjs";
import { prepareToolWorkspace,validateInputManifest } from "./tool-workspace.mjs";
import { scanArtifactWorkspace,collectGeneratedArtifacts } from "./artifact-collector.mjs";
import { inspectInstallation, inspectAllInstallations } from "./tool-manager.mjs";
import { executeNativePlan } from "./native.mjs";
import { normalizeToolResult, failedToolLaunch } from "./tool-result.mjs";
import {
  WorkflowError, METHOD_PROPOSAL_SCHEMA, normalizeUserProblem,
  makeDeepSeekChatProvider, stepsFromMethod, buildExecutionPlan
} from "./workflow-plan.mjs";
import { proposeMethod } from "./method-planner.mjs";
export { listPortfolioTools, describePortfolioTool, inspectPortfolioTool, planPortfolioFixture, runPortableGate, planPortfolioOperation, runPortfolioOperation } from "./tool-portfolio-t4.mjs";
export { loadCapabilityValidation, validateCapabilityValidation, matchValidatedTools } from "./capability-validation.mjs";
export { WorkflowError } from "./workflow-plan.mjs";
export { compilePlan as compileWorkflowPlan } from "./workflow-compiler.mjs";
export { executeWorkflowPlan, WorkflowPlanError, WorkflowBlockedError } from "./workflow-executor.mjs";

export function listTools() { return [...toolIds]; }
export function toolDetails(tool) { return toolRuntimeProfile(tool); }
export async function whereTool(tool,options={}) {return await inspectInstallation(tool,options);}
export async function whereAll(options={}) {return await inspectAllInstallations(options);}
export function planTool(tool,operation,settings={}) { return planNative(tool,operation,settings); }
/**
 * Only registered typed operations are allowed. The caller owns the model,
 * work directory, any side effects from upstream tools, and the interpretation
 * of solver results. Never use this as an unrestricted MCP/shell gateway.
 *
 * @param {{tool:string,operation:string,settings?:Record<string,string|number|boolean>,
 * timeoutS?:number,cwd?:string}} request
 */
export async function invokeTool(request) {
  if(!request||typeof request!=="object")throw new TypeError("tool request is required");
  const {tool,operation,settings={},timeoutS=30,cwd}=request;
  const plan=planNative(tool,operation,settings);
  if(!Number.isInteger(timeoutS)||timeoutS<1||timeoutS>120)
    throw new TypeError("timeoutS must be between 1 and 120 seconds");
  if(cwd!==undefined&&(typeof cwd!=="string"||!cwd.length))
    throw new TypeError("cwd must be a nonempty path");
  try {
    const receipt=await executeNativePlan(plan,{timeout:timeoutS,...(cwd===undefined?{}:{cwd})});
    return normalizeToolResult(plan,receipt);
  }catch(error){
    return failedToolLaunch(plan,error);
  }
}

/**
 * Experimental staged execution of a registered typed operation that has
 * explicitly declared filename arguments. This is a trusted-host convenience
 * wrapper, NOT a sandbox or a project-specific proof workflow.
 *
 * The model/dependencies must already be chosen by the caller; the function
 * stages only explicitly named regular files and does not guess dependencies.
 * @param {{
 *  tool:string,operation:string,sourceRoot:string,inputs:string[],
 *  settings?:Record<string,string|number|boolean>,
 *  timeoutS?:number,
 *  workspaceOptions?:{maxFiles?:number,maxDepth?:number,maxBytes?:number},
 *  artifactOptions?:{maxFiles?:number,maxDepth?:number,maxBytes?:number,maxDirectories?:number,maxEntries?:number,maxSkipped?:number}
 * }} request
 */
// Only the explicitly declared input files are copied into the private cwd.
// Known file-backed options must point to one of those staged files. All
// string options reject obvious absolute/traversal paths even when an upstream
// engine happens to interpret them as filenames rather than ordinary symbols.
const STAGED_INPUT_OPTIONS=new Set(["input","config","facts","shapes","ontology","data","query"]);
/**
 * @param {Record<string,string|number|boolean>} settings
 * @param {string[]} namedInputs
 */
function assertStagedOptionPaths(settings,namedInputs){
  for(const [name,value] of Object.entries(settings)){
    if(typeof value!=="string")continue;
    if(value.startsWith("/")||value.startsWith("\\")||
       /^[A-Za-z]:/.test(value)||value.includes("\0")||
       value.split(/[\\/]/).some(part=>part===".."))
      throw new TypeError("staged option "+name+" may not access paths outside the private workspace");
    if(STAGED_INPUT_OPTIONS.has(name)&&!namedInputs.includes(value))
      throw new TypeError("file option "+name+" must reference an explicitly staged input");
  }
}

export async function invokeStagedTool(request) {
  if(!request||typeof request!=="object")throw new TypeError("staged tool request is required");
  const {tool,operation,sourceRoot,inputs,settings={},timeoutS=30,
    workspaceOptions={},artifactOptions={}}=request;
  // Validate operation and flags before allocating any temporary workspace.
  planNative(tool,operation,settings);
  const operationSpec=describeNativeTool(tool).operations[operation];
  // Apalache test takes <file> <before> <action> <assertion>. Only the first
  // positional is a filesystem input; the other three are state/action names.
  // Keep their typed argv contract, but do not require phantom staged files.
  const nonFilePositionals=tool==="apalache"&&operation==="test"
    ?new Set(["before","action","assertion"]):new Set();
  const requiredFiles=operationSpec.required.filter(name=>!nonFilePositionals.has(name));
  if(!requiredFiles.length)
    throw new TypeError("staged API only supports operations with declared input file arguments");
  const namedInputs=validateInputManifest(inputs,workspaceOptions);
  assertStagedOptionPaths(settings,namedInputs);
  for(const name of requiredFiles) {
    if(typeof settings[name]!=="string"||!namedInputs.includes(settings[name]))
      throw new TypeError("required file option "+name+" must reference an explicitly staged input");
  }
  const staging=await prepareToolWorkspace(sourceRoot,namedInputs,workspaceOptions);
  try {
    // Fail closed: incomplete pre-run inventory cannot distinguish new outputs
    // from existing source files, even when the native process would succeed.
    const baseline=await scanArtifactWorkspace(staging.root,artifactOptions);
    if(baseline.status!=="COMPLETE")
      throw new Error("incomplete pre-execution workspace artifact baseline");
    const result=await invokeTool({tool,operation,settings,timeoutS,cwd:staging.root});
    const staged={
      status:"STAGED_IN_PRIVATE_WORKSPACE",
      inputs:staging.stagedInputs,
      totalBytes:staging.totalBytes
    };
    if(result.process.status==="NOT_STARTED")
      return {...result,staging:staged}; // No native execution, no artifacts claimed.
    let artifacts;
    try {
      artifacts=await collectGeneratedArtifacts(staging.root,baseline,artifactOptions);
      if(["TIMEOUT","OUTPUT_LIMIT"].includes(result.process.status)){
        artifacts={
          ...artifacts,status:"PARTIAL",
          skipped:[...artifacts.skipped,{path:".",reason:"PROCESS_INCOMPLETE"}]
        };
      }
    }catch{
      artifacts={
        schema:"formal-tools/generated-artifacts/1",
        status:"PARTIAL",items:[],unchanged:0,skipped:[{path:".",reason:"POST_RUN_SCAN_FAILED"}],
        scannedFiles:0,hashedBytes:0
      };
    }
    return {...result,staging:staged,artifacts};
  }finally {
    await staging.cleanup();
  }
}

/**
 * Issue #184 (i180/V4b): the ONE reusable workflow contract shared by SDK,
 * CLI and MCP. Plan output is a frozen "formal-tools/execution-plan/1.0"
 * object; planning never executes anything (tool_execution stays NOT_RUN).
 * The deterministic two-solver SMT template is the default; provider:"deepseek"
 * runs ONE real DeepSeek proposal call using DEEPSEEK_API_KEY from the host
 * environment (absent key fails closed with BLOCKED_PROVIDER — never mocked).
 */
const TEMPLATE_CAPABILITY = "logic.smt";
const TEMPLATE_COMPARE_STEP = Object.freeze({
  id: "step-agree", tool: "compare", operation: "cross-check",
  depends_on: ["step-z3", "step-cvc5"],
  input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "unsat"] },
  timeout_s: 5, expected_output_kind: "cross-tool-verdict"
});

/**
 * G2-shaped deterministic method template for the default capability set
 * (["logic.smt"]). Pure data; assessMethod re-admits it inside
 * buildExecutionPlan exactly like an LLM proposal.
 */
function templateMethod(problem, goalClaimIds) {
  return {
    schema: METHOD_PROPOSAL_SCHEMA,
    method_id: "templatesmt01",
    problem_id: problem.problem_id,
    goal_claim_ids: [...goalClaimIds],
    oracle_ids: problem.oracles.map(o => o.id),
    semantic_review: "PENDING",
    steps: [
      { id: "step-z3", tool_id: "z3", operation: "solve", claim_ids: [...goalClaimIds],
        provides: [TEMPLATE_CAPABILITY], depends_on: [], source_refs: ["user-problem-text"],
        estimated_cost_units: 1, timeout_ms: 30000, destination: "LOCAL", output_classification: "PUBLIC" },
      { id: "step-cvc5", tool_id: "cvc5", operation: "solve", claim_ids: [...goalClaimIds],
        provides: [TEMPLATE_CAPABILITY], depends_on: ["step-z3"], source_refs: [],
        estimated_cost_units: 1, timeout_ms: 30000, destination: "LOCAL", output_classification: "PUBLIC" }
    ]
  };
}

function trustedSolverInput(request) {
  const lib = request.smtLib !== undefined ? request.smtLib : request.canonicalText;
  if (typeof lib !== "string" || lib.length === 0)
    throw new WorkflowError("PLAN_INPUT_INVALID",
      "a non-empty solver input is required (non-empty problemText, or an explicit smtLib override); " +
      "the canonical problem text is used verbatim as the SMT-LIB input of both solvers");
  return lib;
}

/**
 * Plan a bounded user problem into a typed ExecutionPlan. Deterministic
 * template by default: the canonical problem text becomes the SMT-LIB input
 * of a z3 + cvc5 cross-check pair, so real SMT-LIB input really solves and
 * prose input honestly fails at execution time (never a fabricated verdict).
 * provider:"deepseek" replaces the template with ONE real LLM proposal; the
 * proposal is untrusted data admitted through the same static gates, and the
 * trusted solver input (problemText or smtLib) is caller-owned as before.
 *
 * @param {{problemText: string, assumptions?: string[], capabilityIds?: string[],
 *          provider?: string, smtLib?: string}} [request]
 * @returns {Promise<{problem: any, plan: any}>}
 */
export async function planWorkflow(request = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "planWorkflow request must be a plain object");
  const known = ["problemText", "assumptions", "capabilityIds", "provider", "smtLib"];
  const unknown = Object.keys(request).filter(k => !known.includes(k));
  if (unknown.length)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "unknown planWorkflow fields: " + unknown.sort().join(","));
  const { problemText, assumptions = [], capabilityIds = [TEMPLATE_CAPABILITY], provider, smtLib } = request;
  if (provider !== undefined && provider !== "deepseek")
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "provider must be 'deepseek' or omitted (deterministic template)");
  const normalized = normalizeUserProblem(problemText, { assumptions, capabilityIds });
  const call = { ...request, canonicalText: normalized.canonical_text };
  if (provider === undefined) {
    if (capabilityIds.length !== 1 || capabilityIds[0] !== TEMPLATE_CAPABILITY)
      throw new WorkflowError("PLAN_INPUT_INVALID",
        "deterministic template planning supports only capabilityIds ['" + TEMPLATE_CAPABILITY + "']; " +
        "pass provider:'deepseek' for an LLM-proposed method");
    const lib = trustedSolverInput(call);
    const goalClaimIds = normalized.problem.claims
      .filter(c => c.kind !== "external_fact" && c.kind !== "not_formalizable").map(c => c.id);
    const method = templateMethod(normalized.problem, goalClaimIds);
    const inputs = { "step-z3": { smt_lib: lib }, "step-cvc5": { smt_lib: lib } };
    const steps = stepsFromMethod(method, inputs, { compareSteps: [structuredClone(TEMPLATE_COMPARE_STEP)] });
    const plan = buildExecutionPlan({
      problem: normalized.problem, method, steps, assumptions: normalized.assumptions
    });
    return { problem: normalized.problem, plan };
  }
  // provider === "deepseek": the key comes from the environment only and is
  // never logged, echoed or mocked. Absent key fails closed before any call.
  if (typeof process.env.DEEPSEEK_API_KEY !== "string" || process.env.DEEPSEEK_API_KEY.length === 0)
    throw new WorkflowError("BLOCKED_PROVIDER",
      "provider 'deepseek' requires DEEPSEEK_API_KEY in the host environment; it is never mocked");
  const lib = trustedSolverInput(call);
  const chat = makeDeepSeekChatProvider({});
  // Egress authority approves exactly the bounded PUBLIC problem this call
  // normalized (byte-identical ProblemSpec JSON), never any other payload.
  const egressAuthority = {
    authorizePublicPayload: async payload =>
      Boolean(payload) && JSON.stringify(payload?.problem) === JSON.stringify(normalized.problem)
  };
  const verdict = await proposeMethod(normalized.problem, chat.generate, egressAuthority);
  if (verdict.status !== "STRUCTURALLY_VALID")
    throw new WorkflowError("PLAN_METHOD_INVALID", "deepseek method proposal was not admitted",
      { status: verdict.status, provider_failure: verdict.provider_failure ?? null, issues: verdict.issues });
  const method = chat.getProposal();
  if (!method)
    throw new WorkflowError("PROVIDER_FAILED", "provider retained no proposal", { reason: "missing_proposal" });
  const inputs = {};
  const solverIds = [];
  for (const step of (Array.isArray(method.steps) ? method.steps : [])) {
    if (step && (step.tool_id === "z3" || step.tool_id === "cvc5")) {
      inputs[step.id] = { smt_lib: lib };
      solverIds.push(step.id);
    }
  }
  const compareSteps = solverIds.length >= 2
    ? [{ ...structuredClone(TEMPLATE_COMPARE_STEP),
         depends_on: [solverIds[0], solverIds[1]],
         input: { left_step: solverIds[0], right_step: solverIds[1], agree_on: ["sat", "unsat"] } }]
    : [];
  const steps = stepsFromMethod(method, inputs, { compareSteps });
  const plan = buildExecutionPlan({
    problem: normalized.problem, method, steps, assumptions: normalized.assumptions
  });
  return { problem: normalized.problem, plan };
}
