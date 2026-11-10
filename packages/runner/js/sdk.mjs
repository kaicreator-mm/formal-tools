/**
 * Experimental JS/TS tooling facade, independent of business model semantics.
 * This is a trusted Node host library, not an arbitrary command execution MCP.
 * It does not auto-install tools, fetch remote models, or choose tool strategies.
 */
import { toolIds, toolRuntimeProfile, planNative } from "./native-catalog.mjs";
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
