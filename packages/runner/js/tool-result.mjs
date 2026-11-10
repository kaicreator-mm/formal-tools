/**
 * General-purpose technical execution result. No consumer business property
 * or verification-policy claims are inferred from tool stdout / exit code.
 * Pure JS, deliberately independent from Node, MCP and any native engine.
 */
const technicalStatuses=new Set(["EXIT_ZERO","NONZERO_EXIT","NOT_STARTED","TIMEOUT","OUTPUT_LIMIT"]);
export function normalizeToolResult(plan,receipt) {
  if(!plan||typeof plan!=="object"||!plan.tool||!plan.operation||!Array.isArray(plan.args))
    throw new TypeError("valid typed operation plan required");
  if(plan.mode!=="typed")throw new TypeError("only typed operations can be normalized through the public SDK");
  const step=Array.isArray(receipt?.executions)?receipt.executions[0]??null:null;
  const pStatus=receipt?.process_outcome??"NOT_STARTED";
  if(!technicalStatuses.has(pStatus))throw new TypeError("unrecognized process status: "+String(pStatus));
  const inconclusive=["TIMEOUT","OUTPUT_LIMIT","NOT_STARTED"].includes(pStatus);
  const toolStatus=inconclusive?"INCONCLUSIVE":receipt?.tool_outcome??"UNPARSED";
  return {
    schema:"formal-tools/tool-execution/1",
    tool_id:plan.tool,
    operation:plan.operation,
    invocation:{entry:plan.entry,args:[...plan.args],mode:"typed"},
    process:{
      run_status:receipt?.run_status??"NOT_RUN",
      status:pStatus,
      exit_code:step?.exit_code??null,
      signal:step?.signal??null,
      elapsed_ms:step?.elapsed_ms??null,
      timed_out:step?.timed_out??false,
      output_truncated:step?.output_truncated??false,
      error:step?.error??null
    },
    tool_status:toolStatus,
    streams:{
      stdout:{text:step?.stdout??"",sha256:step?.stdout_sha256??null},
      stderr:{text:step?.stderr??"",sha256:step?.stderr_sha256??null}
    },
    artifacts:{status:"NOT_COLLECTED",items:[]},
    scope:"UPSTREAM_TOOL_TECHNICAL_RESULT_ONLY"
  };
}
export function failedToolLaunch(plan,error) {
  const reason=error instanceof Error?error.message:String(error);
  return normalizeToolResult(plan,{
    run_status:"NOT_RUN",process_outcome:"NOT_STARTED",tool_outcome:"UNPARSED",
    executions:[{exit_code:null,signal:null,elapsed_ms:null,timed_out:false,
      output_truncated:false,stdout:"",stderr:"",stdout_sha256:null,stderr_sha256:null,error:reason}]
  });
}
