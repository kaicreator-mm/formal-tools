/**
 * Experimental, trusted-host formal-tools API. Types intentionally describe
 * only generic tool management and execution—not solver-selection/business claims.
 * Runtime validates tool IDs against the authoritative JS catalog.
 */
export type ToolSettings = Record<string, string | number | boolean>;
export interface ToolInvokeRequest {
  tool: string;
  operation: string;
  settings?: ToolSettings;
  timeoutS?: number;
  cwd?: string;
}
export interface ScanLimits {
  maxFiles?: number;
  maxDepth?: number;
  maxBytes?: number;
}
export interface StagedToolRequest extends Omit<ToolInvokeRequest, "cwd"> {
  sourceRoot: string;
  inputs: string[];
  workspaceOptions?: ScanLimits;
  artifactOptions?: ScanLimits & {maxDirectories?: number; maxEntries?: number; maxSkipped?: number};
}
export interface ToolArtifact {
  path: string;
  bytes: number;
  sha256: string;
}
export interface TechnicalProcess {
  run_status: string;
  status: "EXIT_ZERO" | "NONZERO_EXIT" | "NOT_STARTED" | "TIMEOUT" | "OUTPUT_LIMIT";
  exit_code: number | null;
  signal: string | null;
  elapsed_ms: number | null;
  timed_out: boolean;
  output_truncated: boolean;
  error: string | null;
}
export interface ToolExecutionResult {
  schema: "formal-tools/tool-execution/1";
  tool_id: string;
  operation: string;
  invocation: { entry: string; args: string[]; mode: "typed" };
  process: TechnicalProcess;
  tool_status: string;
  streams: {
    stdout: { text: string; sha256: string | null };
    stderr: { text: string; sha256: string | null };
  };
  artifacts: {
    status: "NOT_COLLECTED" | "COMPLETE" | "PARTIAL";
    items: ToolArtifact[];
    skipped?: {path: string; reason: string}[];
    scannedFiles?: number;
    hashedBytes?: number;
    unchanged?: number;
  };
  staging?: {
    status: "STAGED_IN_PRIVATE_WORKSPACE";
    inputs: ToolArtifact[];
    totalBytes: number;
  };
  scope: "UPSTREAM_TOOL_TECHNICAL_RESULT_ONLY";
}
export interface ToolPlan {
  tool: string;
  operation: string;
  entry: string;
  args: string[];
  mode: "typed";
  runtime: string;
}
export interface ToolRuntimeProfile {
  id: string;
  title: string;
  source: string;
  entries: string[];
  help: {entry: string; args: string[]};
  runtime: {
    kind: "binary" | "java-jar" | "alloy" | "python-module";
    command: string;
    probeArgs: string[];
    [key: string]: unknown;
  };
  operationCount: number;
}
export interface InstallationInspection {
  tool: string;
  status: string;
  launcher: string;
  probe_status: string;
  executable?: string;
  missing?: string[];
  diagnostics: string[];
  argv?: string[];
}
export function listTools(): string[];
export function toolDetails(tool: string): ToolRuntimeProfile;
export function whereTool(tool: string, options?: Record<string, unknown>): Promise<InstallationInspection>;
export function whereAll(options?: Record<string, unknown>): Promise<{
  status: string; tools: number; counts: Record<string, number>;
  checks: InstallationInspection[];
}>;
export function planTool(tool: string, operation: string, settings?: ToolSettings): ToolPlan;
export function invokeTool(request: ToolInvokeRequest): Promise<ToolExecutionResult>;
export function invokeStagedTool(request: StagedToolRequest): Promise<ToolExecutionResult>;

/** Issue #24 T4 portfolio is discovery + fixed-fixture only, not T5 semantics. */
export interface PortfolioTool {
  id: string;
  origin: "native-ref" | "candidate";
  expected_version: string;
  capability_ids: string[];
  execution_adapter: string;
  t4_status: string;
  t5_status: string;
}
export interface PortfolioFixturePlan {
  tool: string;
  operation: "verify-fixture";
  entry: "portable/bin/tool-runner";
  args: string[];
  mode: "typed";
  scope: string;
}
export interface PortfolioGateReceipt {
  schema: "formal-tools/portfolio-t4-technical/0.1";
  tool: string;
  operation: string;
  status: string;
  process?: { exit_code: number | null; signal: string | null; timed_out: boolean;
    output_limit: boolean; elapsed_ms: number; error: string | null };
  reason?: string;
  runner_sha256?: string;
  metadata_sha256?: string;
  fixture_contract_sha256?: string;
  receipt_sha256?: string | null;
  streams?: { stdout: string; stderr: string; stdout_sha256: string; stderr_sha256: string };
  cases?: { phase: string; exit_code: number; duration_ms: number;
    semantic_pattern_matched: boolean; exit_contract_matched: boolean; label: string }[];
  scope: string;
}
export function listPortfolioTools(): PortfolioTool[];
export function describePortfolioTool(tool: string): PortfolioTool & {
  official_url: string; operations: string[]; raw_argv_allowed: false };
export function inspectPortfolioTool(tool: string): Promise<PortfolioTool & {
  status: string; reason?: string; runner_sha256?: string;
  metadata_sha256?: string; fixture_contract_sha256?: string }>;
export function planPortfolioFixture(tool: string): PortfolioFixturePlan;
export function runPortableGate(tool: string, options?: {
  mode?: "verify-fixture" | "doctor"; timeoutS?: number
}): Promise<PortfolioGateReceipt>;


/** A bounded, typed linear program for the single admitted Highs 1.15.1 Python Library operation. */
export interface HighsLinearProgram {
  sense: "min" | "max";
  objective: number[];
  variables: { lower: number | null; upper: number | null }[];
  constraints: {
    lower: number | null;
    upper: number | null;
    coefficients: number[];
  }[];
}
export interface PortfolioOperationPlan {
  tool: "highs";
  operation: "solve-lp";
  schema: "formal-tools/highs-solve-lp/1.0";
  capability_ids: string[];
  model: HighsLinearProgram;
  input_sha256: string;
  mode: "typed";
  budget: {
    max_variables: 64;
    max_constraints: 128;
    max_input_bytes: number;
    max_timeout_s: 30;
  };
  raw_argv_allowed: false;
}
export interface PortfolioOperationReceipt {
  schema: "formal-tools/portfolio-operation/0.1";
  tool: "highs";
  operation: "solve-lp";
  status: "T4_OPERATION_EXECUTED_UNREVIEWED" | "PORTFOLIO_OPERATION_FAILED" | "NOT_RUN_FAIL_CLOSED";
  qualification: "NOT_T4_ACCEPTED_INDEPENDENT_REVIEW_PENDING" | "NOT_T4_ACCEPTED";
  capability_ids?: string[];
  process?: {
    exit_code: number | null;
    signal: string | null;
    timed_out: boolean;
    output_limit: boolean;
    elapsed_ms: number;
    error: string | null;
  };
  runner_sha256?: string;
  metadata_sha256?: string;
  fixture_contract_sha256?: string;
  operation_script_sha256?: string;
  input_sha256?: string;
  solver?: {
    schema: "formal-tools/highs-solve-lp/1.0";
    tool: "highs";
    highspy_version: "1.15.1";
    numpy_version: string;
    python_version: string;
    input_sha256: string;
    model_status: "kOptimal" | "kInfeasible" | "kUnbounded" | "kUnboundedOrInfeasible" | "kTimeLimit";
    objective: number | null;
    variables: number[];
    solver_api_status: "kOk";
  } | null;
  streams?: { stdout: string; stderr: string; stdout_sha256: string; stderr_sha256: string };
  budget?: { timeout_s: number; solver_time_limit_s: number; max_variables: 64; max_constraints: 128 };
  reason?: string;
  scope: string;
}
export function planPortfolioOperation(tool: "highs", operation: "solve-lp", model: HighsLinearProgram): PortfolioOperationPlan;
export function runPortfolioOperation(tool: "highs", operation: "solve-lp", model: HighsLinearProgram, options?: {
  timeoutS?: number;
}): Promise<PortfolioOperationReceipt>;

/** r176 capability validation ledger: technical probe evidence only, never a
 * lifecycle gate or formal acceptance claim (see registry/INTERFACES.json). */
export interface CapabilityVersionDrift {
  declared: string;
  probed: string;
  note: string;
}
export interface CapabilityProbeIo {
  inputs: string[];
  outputs: string[];
}
export interface CapabilityValidationOptions {
  discovery?: unknown;
  receiptHasher?: (repoRelativePath: string) => string;
}
export interface CapabilityValidationReport {
  ok: boolean;
  issues: string[];
}
export interface CapabilityToolMatch {
  id: string;
  origin: string;
  matched_capabilities: string[];
  status: string;
  probe_quality: string;
  declared_version: string;
  probed_version: string | null;
  version_drift: CapabilityVersionDrift | null;
  evidence_ref: string;
  applicable_problems: string[];
  io: CapabilityProbeIo;
  limitations: string;
}
export interface CapabilityValidationRow extends Omit<CapabilityToolMatch, "matched_capabilities"> {
  capability_ids: string[];
  evidence_sha256: string | null;
  verify_verdict: string;
  verify_phases: string[];
  probe_status: string;
  probe_note: string | null;
  container_probe_receipt: {path: string; sha256: string} | null;
}
export interface CapabilityValidationLedger {
  schema: "formal-tools/capability-validation/0.1";
  status: string;
  authority: Record<string, unknown>;
  semantics: Record<string, unknown>;
  scope_rules: string[];
  counts: Record<string, number>;
  tools: CapabilityValidationRow[];
}
export interface CapabilityMatchResult {
  required_capabilities: string[];
  matches: CapabilityToolMatch[];
  uncovered_capabilities: string[];
  status: string;
}
export function loadCapabilityValidation(options?: CapabilityValidationOptions): CapabilityValidationLedger;
export function validateCapabilityValidation(input: unknown, options?: CapabilityValidationOptions): CapabilityValidationReport;
export function matchValidatedTools(capabilityIds: readonly string[], options?: {includeNotVerified?: boolean}): CapabilityMatchResult;

/** Issue #184 (i180/V4b): unified workflow plan/execute/results contract. */
export interface WorkflowProblemSpec {
  schema: "formal-tools/problem-spec/0.1";
  problem_id: string;
  [key: string]: unknown;
}
export interface WorkflowPlanStep {
  id: string;
  tool: "z3" | "cvc5" | "highs" | "compare";
  operation: "solve-smt" | "solve-lp" | "cross-check";
  depends_on: string[];
  input: unknown;
  input_sha256: string;
  timeout_s: number;
  expected_output_kind: "smt-answer" | "lp-status" | "cross-tool-verdict";
}
export interface WorkflowExecutionPlan {
  schema: "formal-tools/execution-plan/1.0";
  plan_id: string;
  source: { problem_sha256: string; problem_kind: string };
  assumptions: string[];
  method_dag: { id: string; kind: string; depends_on: string[] }[];
  steps: WorkflowPlanStep[];
  budgets: { max_steps: number; max_total_timeout_s: number };
  compiled: { launcher_sha256: string | null; manifest_sha256: string | null };
}
export interface WorkflowLauncherManifest {
  schema: "formal-tools/launcher-manifest/1.0";
  plan_id: string;
  plan_sha256: string;
  launcher_sha256: string;
  entry: string;
  runtime: string;
  generated_by: string;
  deterministic: true;
}
export interface WorkflowPlanRequest {
  problemText: string;
  assumptions?: string[];
  capabilityIds?: string[];
  provider?: "deepseek";
  smtLib?: string;
}
export interface WorkflowPlanResult {
  problem: WorkflowProblemSpec;
  plan: WorkflowExecutionPlan;
}
export interface WorkflowCompileResult {
  launcher: string;
  manifest: WorkflowLauncherManifest;
  plan: WorkflowExecutionPlan;
}
export interface WorkflowStepRecord {
  step_id: string;
  tool: string;
  operation: string;
  status: "EXECUTED" | "NOT_RUN" | "TIMEOUT" | "ERROR" | "SKIPPED_DOWNSTREAM";
  exit_code: number | null;
  elapsed_ms: number | null;
  stdout_sha256: string | null;
  stderr_sha256: string | null;
  stdout_bounded: string | null;
  stderr_bounded: string | null;
  result: Record<string, unknown> | null;
  artifacts: { name: string; sha256: string | null; bytes: number }[];
}
export interface WorkflowExecutionReceipt {
  schema: "formal-tools/execution-receipt/1.0";
  run_id: string;
  plan_id: string;
  plan_sha256: string;
  source_sha: string | null;
  created_at: string;
  tool_versions: Record<string, { version: string; probe_sha256: string | null; probe_bounded: string | null }>;
  steps: WorkflowStepRecord[];
  overall: {
    process_outcome: "OK" | "PARTIAL" | "FAILED" | "ABORTED";
    solver_answer: { kind: string; value: string | null; by_step: { step_id: string; tool: string; operation: string; answer: string }[] };
    cross_tool_verdict: "AGREE_SAT" | "AGREE_UNSAT" | "CONTRADICTION" | "UNKNOWN" | "NOT_APPLICABLE";
    claim_verdict: "PASS" | "UNSUPPORTED_BY_MVP" | "NOT_APPLICABLE" | "BLOCKED";
    fail_closed_reason?: string;
  };
  environment: { host: string; node: string; formal_portable_root_sha: string | null };
}
export interface WorkflowCaptureResult {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  output_limit: boolean;
  error: string | null;
  stdout: string;
  stderr: string;
}
export interface WorkflowExecuteOptions {
  captureImpl?: ((argv: string[], opts: { cwd: string; timeoutMs: number; env: Record<string, string> }) => Promise<WorkflowCaptureResult>) | null;
  solveLpImpl?: ((tool: string, operation: string, model: unknown, opts: { timeoutS: number }) => Promise<unknown>) | null;
  workspaceDir?: string | null;
  sourceSha?: string | null;
  env?: Record<string, string>;
  now?: (() => number) | number | null;
  runId?: string | null;
  host?: string | null;
}
/** Stable WorkflowError codes (planning): PLAN_SCHEMA_INVALID, PLAN_UNKNOWN_TOOL,
 * PLAN_UNKNOWN_OPERATION, PLAN_DUP_STEP_ID, PLAN_UNBOUND_DEP, PLAN_CYCLE,
 * PLAN_HASH_MISMATCH, PLAN_BUDGET_EXCEEDED, PLAN_INPUT_INVALID, PLAN_OVERSIZED,
 * PLAN_METHOD_INVALID, BLOCKED_PROVIDER, PROVIDER_FAILED. */
export declare class WorkflowError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}
/** Executor plan-revalidation error (nothing ran, nothing written). */
export declare class WorkflowPlanError extends Error {
  code: string;
  constructor(code: string, message: string);
}
/** Preflight fail-closed error; carries the full ABORTED receipt as evidence. */
export declare class WorkflowBlockedError extends Error {
  code: string;
  detail: unknown;
  receipt: WorkflowExecutionReceipt | null;
  workspaceDir: string | null;
  constructor(code: string, message: string, detail?: unknown);
}
/**
 * Plan a bounded user problem. Deterministic two-solver SMT template by
 * default; provider:"deepseek" performs ONE real DeepSeek proposal call using
 * DEEPSEEK_API_KEY from the environment (absent key: BLOCKED_PROVIDER, never
 * mocked). Planning never executes anything.
 */
export function planWorkflow(request: WorkflowPlanRequest): Promise<WorkflowPlanResult>;
/** Deterministic launcher/manifest compilation (delegates compilePlan). */
export function compileWorkflowPlan(plan: WorkflowExecutionPlan): WorkflowCompileResult;
/** Execute a validated plan on this trusted host. Binary-less environments
 * fail closed: WorkflowBlockedError with an ABORTED receipt attached
 * (fail_closed_reason BLOCKED_TOOL_MISSING) — an honest outcome, not a crash. */
export function executeWorkflowPlan(plan: WorkflowExecutionPlan, options?: WorkflowExecuteOptions): Promise<{ receipt: WorkflowExecutionReceipt; workspaceDir: string }>;
