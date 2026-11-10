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
 *  artifactOptions?:{maxFiles?:number,maxDepth?:number,maxBytes?:number}
 * }} request
 */
export async function invokeStagedTool(request) {
  if(!request||typeof request!=="object")throw new TypeError("staged tool request is required");
  const {tool,operation,sourceRoot,inputs,settings={},timeoutS=30,
    workspaceOptions={},artifactOptions={}}=request;
  // Validate operation and flags before allocating any temporary workspace.
  planNative(tool,operation,settings);
  const operationSpec=describeNativeTool(tool).operations[operation];
  if(!operationSpec.required.length)
    throw new TypeError("staged API only supports operations with declared input file arguments");
  const namedInputs=validateInputManifest(inputs,workspaceOptions);
  for(const name of operationSpec.required) {
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
