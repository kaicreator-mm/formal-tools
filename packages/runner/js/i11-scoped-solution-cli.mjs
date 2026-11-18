#!/usr/bin/env node
/** Standalone #11 R109 C local CLI; does not change shared portfolio CLI. */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {admitScopedSolution,consumeScopedSolution,revokeScopedSolution,
  observeLocalScopedEvidence} from "./i11-scoped-solution.mjs";

export async function main(argv=process.argv.slice(2)){
  const [command,dir,id,nonce,scope]=argv;
  let result;
  if(command==="admit" && argv.length===2){
    result=await admitScopedSolution({store_dir:resolve(dir)});
  }else if(command==="consume" && argv.length===5){
    result=await consumeScopedSolution({store_dir:resolve(dir),request:{
      schema:"formal-tools/i11-scoped-consumption/1",solution_id:id,
      consumer_id:"formal-tools-local-consumer",scope,nonce,
      now_ms:Date.now(),observed:observeLocalScopedEvidence(),
      tool_outcome:"PROVEN",budget_ms:1000
    }});
  }else if(command==="revoke" && argv.length===3){
    result=await revokeScopedSolution({store_dir:resolve(dir),solution_id:id});
  }else{
    result={status:"ERROR",reason:"USAGE: admit DIR | consume DIR ID NONCE SCOPE | revoke DIR ID",
      effect_dispatched:false};
  }
  process.stdout.write(JSON.stringify(result)+"\n");
  // Per-command single success status: a consume that does not yield
  // CONSUMED_READ_ONLY (e.g. INVALIDATED after durable revocation) is a
  // rejected operation and exits non-zero; INVALIDATED is only the success
  // status of the revoke command itself.
  const success={admit:"QUALIFIED_WITH_SCOPE",consume:"CONSUMED_READ_ONLY",
    revoke:"INVALIDATED"}[command];
  return result.status===success?0:2;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await main();
