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
