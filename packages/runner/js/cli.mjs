#!/usr/bin/env node
/** Node ESM CLI. Native external tools require Node host process permissions. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { verifyPure } from "../../core/src/finite.mjs";
import { knownTools, inspectTool, validateSource, doctor, runFixture, executeNativePlan } from "./native.mjs";
import { describeNativeTool, planNative, planRawNative, planNativeHelp, toolIds } from "./native-catalog.mjs";

function localParams(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    const token=args[i];
    if(!token.startsWith("--")||token==="--")throw new TypeError("expected --option value: "+token);
    const key=token.slice(2);
    if(!/^[a-z][a-z0-9_-]*$/i.test(key)||Object.hasOwn(out,key))throw new TypeError("invalid or repeated option "+key);
    const next=args[i+1];
    if(next===undefined||next.startsWith("--")){out[key]=true;continue;}
    if(/^-?\d+$/.test(next)){out[key]=Number(next);}else out[key]=next;
    i++;
  }
  return out;
}
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
    } else if (action==="catalog") {
      result=arg?describeNativeTool(arg):toolIds.map(describeNativeTool);
    } else if (action==="plan") {
      const [op,...opts]=rest;
      result=planNative(arg,op,localParams(opts));
    } else if (action==="exec") {
      const [op,...opts]=rest;
      const params=localParams(opts);
      const timeout=params.timeout??30;
      const cwd=params.cwd??process.cwd();
      delete params.timeout;delete params.cwd;
      result=await executeNativePlan(planNative(arg,op,params),{cwd,timeout});
    } else if (action==="native-help") {
      const opts=localParams(rest);
      if(Object.keys(opts).some(k=>!["entry","timeout","cwd"].includes(k)))throw new TypeError("invalid help options");
      result=await executeNativePlan(planNativeHelp(arg,opts.entry),{timeout:opts.timeout??15,cwd:opts.cwd??process.cwd()});
    } else if (action==="native") {
      const split=rest.indexOf("--");
      if(split<0)throw new TypeError("raw local native CLI requires -- before native argv");
      const opts=localParams(rest.slice(0,split));
      if(Object.keys(opts).some(k=>!["entry","timeout","cwd"].includes(k)))throw new TypeError("invalid raw options");
      const entry=opts.entry??describeNativeTool(arg).entries[0];
      result=await executeNativePlan(planRawNative(arg,entry,rest.slice(split+1)),
        {allowRaw:true,cwd:opts.cwd??process.cwd(),timeout:opts.timeout??30});
    } else if (action==="pure") {
      const path=flag(rest,"--input");
      if (!path) throw new TypeError("pure requires --input <JSON-file>");
      const model=JSON.parse(await readFile(path,"utf8"));
      result=verifyPure(arg,model);
    } else {
      throw new TypeError("Usage: cli.mjs <list|validate|catalog [TOOL]|plan TOOL OP --option value|exec TOOL OP --option value|native-help TOOL|native TOOL -- [official args]|inspect TOOL|doctor TOOL|run TOOL --case positive|negative|suite|pure KIND --input file.json>");
    }
    print(result);
    if(action==="validate")return result.status==="STATIC_PASS"?0:2;
    if(action==="run")return result.test_verdict==="PASS"?0:2;
    if(action==="suite")return result.results.every(x=>x.test_verdict==="PASS")?0:2;
    if(action==="doctor")return result.run_status==="EXECUTED"&&result.exit_code===0?0:2;
    if(action==="pure")return result.tool_outcome==="UNKNOWN"?2:0;
    if(["exec","native","native-help"].includes(action))return result.process_outcome==="EXIT_ZERO"?0:2; // counterexample is a meaningful observation
    return 0;
  } catch(e) {
    process.stderr.write(JSON.stringify({status:"ERROR",message:String(e)})+"\n");
    return 2;
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await main();
