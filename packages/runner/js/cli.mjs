#!/usr/bin/env node
/** Node ESM CLI. Native external tools require Node host process permissions. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { verifyPure } from "../../core/src/finite.mjs";
import { knownTools, inspectTool, validateSource, doctor, runFixture } from "./native.mjs";

function flag(args,key,defaultValue) {
  const i=args.indexOf(key);
  return i<0?defaultValue:args[i+1];
}
const print=x=>process.stdout.write(JSON.stringify(x,null,2)+"\n");
export async function main(args=process.argv.slice(2)) {
  const [action,arg,...rest]=args;
  try {
    let result;
    if (action==="list") {
      result={native_tools:knownTools(),pure_engines:["dag","writers","cnf","states"]};
    } else if (action==="validate") {
      result=await validateSource();
    } else if (action==="inspect") {
      result=await inspectTool(arg);
    } else if (action==="doctor") {
      result=await doctor(arg,Number(flag(rest,"--timeout",15)));
    } else if (action==="run") {
      result=await runFixture(arg,flag(rest,"--case"),Number(flag(rest,"--timeout",30)));
    } else if (action==="suite") {
      const timeout=Number(flag(args,"--timeout",30));
      const results=[];
      for(const tool of knownTools()) for(const which of ["positive","negative"])
        results.push(await runFixture(tool,which,timeout));
      result={cases:results.length,results};
    } else if (action==="pure") {
      const path=flag(rest,"--input");
      if (!path) throw new TypeError("pure requires --input <JSON-file>");
      const model=JSON.parse(await readFile(path,"utf8"));
      result=verifyPure(arg,model);
    } else {
      throw new TypeError("Usage: cli.mjs <list|validate|inspect TOOL|doctor TOOL|run TOOL --case positive|negative|suite|pure KIND --input file.json>");
    }
    print(result);
    if(action==="validate")return result.status==="STATIC_PASS"?0:2;
    if(action==="run")return result.test_verdict==="PASS"?0:2;
    if(action==="suite")return result.results.every(x=>x.test_verdict==="PASS")?0:2;
    if(action==="doctor")return result.run_status==="EXECUTED"&&result.exit_code===0?0:2;
    if(action==="pure")return result.tool_outcome==="UNKNOWN"?2:0; // counterexample is a meaningful observation
    return 0;
  } catch(e) {
    process.stderr.write(JSON.stringify({status:"ERROR",message:String(e)})+"\n");
    return 2;
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await main();
