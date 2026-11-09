/**
 * Node.js adapter: exposes the same allowlisted formal tool operations to CLI/MCP.
 * Only fixed, Git-tracked example inputs may reach native binaries.
 * Real binary/MCP integration remains NOT_RUN until executed with receipts.
 */
import { readFile, readdir, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describeNativeTool } from "./native-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TOOLS = Object.freeze(["lean4","z3","tla-tlc","apalache","alloy","souffle","rdf-shacl","cvc5","vampire","clingo","apache-jena","prob","dafny"]);
const MAX_TIMEOUT = 120_000;
const MAX_OUTPUT = 1_048_576;
const sha = input => createHash("sha256").update(input).digest("hex");
const file = (...names) => join(ROOT, ...names);
const textFile = async (...names) => await readFile(file(...names), "utf8");
const fixture = (tool, name) => file("skills",tool,"examples",name);
const inputNames = (command) => [...command.matchAll(/examples\/([\w.-]+)/g)].map(m => m[1]);

export function knownTools() { return [...TOOLS]; }
function assertTool(tool) { if (!TOOLS.includes(tool)) throw new TypeError("unknown formal tool: " + tool); }
function assertTimeout(n) { if (!Number.isInteger(n) || n < 1 || n > 120) throw new TypeError("timeout must be 1..120 seconds"); }
export async function inspectTool(tool) {
  assertTool(tool);
  const json = JSON.parse(await textFile("validation","SKILL_ACCEPTANCE_CASES.json"));
  const entry = json.cases.find(v => v.id === tool);
  if (!entry) throw new TypeError("missing registry entry: " + tool);
  return entry;
}
export async function validateSource() {
  const issues = [];
  const reg = JSON.parse(await textFile("registry","SKILL_REGISTRY.json"));
  const ids = reg.tools.map(x=>x.id);
  if (ids.length !== 13 || new Set(ids).size !== 13 || ids.some(id=>!TOOLS.includes(id))) issues.push("registry tool set mismatch");
  for (const tool of TOOLS) {
    const skill = await textFile("skills",tool,"SKILL.md").catch(()=>null);
    if (!skill || !skill.startsWith("---\nname: " + tool + "\n")) issues.push("invalid skill header: "+tool);
    const entry = await inspectTool(tool);
    for (const key of ["positive_command","negative_command"]) {
      const names = inputNames(entry[key]);
      if (!names.length) issues.push("missing input: "+tool+" "+key);
      for (const name of names) {
        await stat(fixture(tool,name)).catch(()=>issues.push("missing file "+tool+"/"+name));
      }
    }
  }
  return {status:issues.length?"STATIC_FAIL":"STATIC_PASS",count:TOOLS.length,issues,native_runtime:"NOT_RUN"};
}
function executable(name) {
  const directory=process.env.FORMAL_TOOLS_BIN_DIR;
  return directory ? join(directory,name) : name;
}
function toolPython(tool) { return process.env[tool === "clingo" ? "FORMAL_CLINGO_PYTHON" : "FORMAL_PYSHACL_PYTHON"] || "python3"; }
function jar(variable) {
  const p=process.env[variable];
  if (!p) throw new TypeError(variable+" must point to an installed jar");
  return resolve(p);
}
function commands(tool,which,output) {
  assertTool(tool);
  if (!["positive","negative"].includes(which)) throw new TypeError("case must be positive/negative");
  const positive=which==="positive", stem=positive?"positive":"negative";
  if (tool==="z3") return [[executable("z3"),"-smt2",fixture(tool,stem+".smt2")]];
  if (tool==="cvc5") return [[executable("cvc5"),"--lang","smt2",fixture(tool,stem+".smt2")]];
  if (tool==="lean4") return [[executable("lean"),fixture(tool,positive?"Positive.lean":"Negative.lean")]];
  if (tool==="dafny") return [[executable("dafny"),"verify",fixture(tool,positive?"Positive.dfy":"Negative.dfy")]];
  if (tool==="vampire") return [[executable("vampire"),"--mode","casc",fixture(tool,stem+".p")]];
  if (tool==="clingo") return [[toolPython(tool),"-m","clingo",fixture(tool,stem+".lp"),"0"]];
  if (tool==="rdf-shacl") return [[toolPython(tool),"-m","pyshacl","-s",fixture(tool,"shapes.ttl"),"-df","turtle","-sf","turtle","-f","human",fixture(tool,stem+".ttl")]];
  if (tool==="souffle") return [[executable("souffle"),fixture(tool,stem+".dl"),"-D",output]];
  if (tool==="tla-tlc") return [[executable("java"),"-cp",jar("TLA2TOOLS_JAR"),"tlc2.TLC","-config",fixture(tool,"Toggle.cfg"),fixture(tool,positive?"TogglePositive.tla":"ToggleNegative.tla")]];
  if (tool==="apalache") return [[executable("apalache-mc"),"check","--init=Init","--next=Next","--inv=Inv","--length=3",fixture(tool,positive?"TogglePositive.tla":"ToggleNegative.tla")]];
  if (tool==="alloy") {
    const prefix=process.env.FORMAL_ALLOY_JAR?[executable("java"),"-jar",jar("FORMAL_ALLOY_JAR")]:[executable("alloy")];
    return [[...prefix,"exec","-c","0",fixture(tool,stem+".als")]];
  }
  if (tool==="prob") return [[executable("probcli"),fixture(tool,positive?"Positive.mch":"Negative.mch"),"-model_check"]];
  if (tool==="apache-jena") {
    const tt=fixture(tool,positive?"data.ttl":"invalid.ttl");
    return positive ? [[executable("riot"),"--validate",tt],[executable("arq"),"--data",tt,"--query",fixture(tool,"query.rq")]] : [[executable("riot"),"--validate",tt]];
  }
  throw new TypeError("unknown tool");
}
function versionCommand(tool) {
  const version={
    lean4:["lean","--version"], z3:["z3","-version"], cvc5:["cvc5","--version"],
    souffle:["souffle","--version"], vampire:["vampire","--help"], prob:["probcli","-version"],
    dafny:["dafny","--version"], apalache:["apalache-mc","version"],
    "apache-jena":["riot","--help"], alloy:["alloy","help"]
  };
  if (tool==="alloy"){
    if (process.env.FORMAL_ALLOY_JAR)
      return [executable("java"),"-jar",resolve(process.env.FORMAL_ALLOY_JAR),"help"];
    if (process.env.FORMAL_ALLOY_BIN)
      return [resolve(process.env.FORMAL_ALLOY_BIN),"help"];
    throw new TypeError("Alloy Analyzer binary is ambiguous; configure FORMAL_ALLOY_JAR or FORMAL_ALLOY_BIN");
  }
  if (tool==="tla-tlc") return [executable("java"),"-cp",jar("TLA2TOOLS_JAR"),"tlc2.TLC","-help"];
  if (tool==="clingo"||tool==="rdf-shacl") return [toolPython(tool),"-m",tool==="clingo"?"clingo":"pyshacl","--help"];
  return [executable(version[tool][0]),...version[tool].slice(1)];
}
async function capture(argv,{cwd,timeoutMs}) {
  if (!Array.isArray(argv)||!argv.length) throw new TypeError("empty command");
  return await new Promise(resolveResult=>{
    let stdout=[],stderr=[],bytes=0,timeout=false,error=null,settled=false;
    const start=Date.now();
    const child=spawn(argv[0],argv.slice(1),{cwd,shell:false,stdio:["ignore","pipe","pipe"],env:process.env});
    const finish=(code,signal)=>{
      if (settled) return;
      settled=true;clearTimeout(timer);
      const out=Buffer.concat(stdout),err=Buffer.concat(stderr);
      resolveResult({argv,exit_code:code,signal,elapsed_ms:Date.now()-start,timed_out:timeout,
        stdout:out.toString("utf8").slice(0,6000),stderr:err.toString("utf8").slice(0,6000),
        stdout_sha256:sha(out),stderr_sha256:sha(err),error:error?.message??null,output_truncated:bytes>MAX_OUTPUT});
    };
    const append=(chunks,b)=>{
      bytes+=b.length;
      if (bytes<=MAX_OUTPUT) chunks.push(b);
      else {error=new Error("output exceeded 1 MiB");child.kill("SIGKILL");}
    };
    child.stdout?.on("data",b=>append(stdout,b));
    child.stderr?.on("data",b=>append(stderr,b));
    child.on("error",e=>{error=e;finish(null,null);});
    child.on("close",(code,signal)=>finish(code,signal));
    const timer=setTimeout(()=>{timeout=true;child.kill("SIGKILL");},timeoutMs);
  });
}
export async function doctor(tool,timeout=15) {
  assertTool(tool);assertTimeout(timeout);
  try {
    const argv=versionCommand(tool);
    const p=await capture(argv,{cwd:ROOT,timeoutMs:timeout*1000});
    return {tool,run_status:p.error?"NOT_RUN":"EXECUTED",version_verdict:"UNVERIFIED",...p};
  } catch(e) {return {tool,run_status:"NOT_RUN",version_verdict:"UNVERIFIED",error:String(e)};}
}
export function interpret(tool,which,steps,extra={}) {
  if (!steps.length||steps.some(x=>x.timed_out||x.error||x.output_truncated)) return {tool_outcome:"UNKNOWN",test_verdict:"INCONCLUSIVE"};
  const text=steps.map(x=>x.stdout+"\n"+x.stderr).join("\n"),lower=text.toLowerCase(),positive=which==="positive";
  const exit=steps.at(-1).exit_code;
  if (tool==="z3"||tool==="cvc5") {
    const tokens=[...lower.matchAll(/^\s*(sat|unsat|unknown)\s*$/gm)];
    const observed=tokens.at(-1)?.[1]??"unparsed";
    return {tool_outcome:observed.toUpperCase(),test_verdict:exit===0&&observed===(positive?"unsat":"sat")?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="clingo") {
    const outcome=/^UNSATISFIABLE\s*$/m.test(text)?"UNSATISFIABLE":/^SATISFIABLE\s*$/m.test(text)?"SATISFIABLE":"UNPARSED";
    const models=[...text.matchAll(/^Answer:\s*\d+/gm)].length;
    return {tool_outcome:outcome,test_verdict:positive?(outcome==="SATISFIABLE"&&models===2&&[0,10].includes(exit)?"PASS":"INCONCLUSIVE"):(outcome==="UNSATISFIABLE"&&[0,20].includes(exit)?"PASS":"INCONCLUSIVE")};
  }
  if (tool==="rdf-shacl") {
    const conforms=text.match(/Conforms:\s*(True|False)/i)?.[1]?.toLowerCase()??"unparsed";
    return {tool_outcome:conforms.toUpperCase(),test_verdict:conforms===(positive?"true":"false")&&(positive?exit===0:[0,1].includes(exit))?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="lean4") {
    const ok=positive?(exit===0&&!/\bsorry\b/i.test(text)):(exit!==0&&/unsolved goals|type mismatch/i.test(text));
    return {tool_outcome:ok?(positive?"PROVED":"REJECTED"):"UNPARSED",test_verdict:ok?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="dafny") {
    const ok=positive?(exit===0&&/verified,\s*0\s*errors/i.test(text)):(exit!==0&&/postcondition/i.test(text));
    return {tool_outcome:ok?(positive?"VERIFIED":"REFUTED"):"UNPARSED",test_verdict:ok?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="vampire") {
    const szs=text.match(/SZS status\s+([A-Za-z]+)\b/)?.[1]??null;
    if(!szs) return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
    if(szs==="Theorem") return {tool_outcome:"THEOREM",test_verdict:positive&&exit===0?"PASS":"INCONCLUSIVE"};
    // False conjecture under --mode casc: Vampire saturates the negated goal.
    if(szs==="CounterSatisfiable") return {tool_outcome:"COUNTER_SATISFIABLE",test_verdict:!positive&&exit===0?"PASS":"INCONCLUSIVE"};
    return {tool_outcome:szs.toUpperCase(),test_verdict:"INCONCLUSIVE"};
  }
  if (tool==="souffle") {
    if (exit!==0||!Array.isArray(extra.cycle))return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
    const cyclic=extra.cycle.length>0;
    const reachable=Array.isArray(extra.reach)&&extra.reach.some(x=>x==="A\tC"||x==="A,C");
    return {tool_outcome:cyclic?"CYCLIC":"ACYCLIC",test_verdict:(positive?!cyclic&&reachable:cyclic)?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="apache-jena") {
    // Jena 6.x logs fatal syntax errors as "ERROR riot :: ..."; older builds may
    // throw RiotException/ParseException text instead.
    const good=positive?(steps.every(x=>x.exit_code===0)&&text.includes("urn:a")&&text.includes("urn:b")):(exit!==0&&/(riotexception|parseexception|syntax error|ERROR\s+riot)/i.test(text));
    return {tool_outcome:good?(positive?"QUERY_MATCH":"INVALID_TURTLE"):"UNPARSED",test_verdict:good?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="tla-tlc") {
    const completed=/Model checking completed/.test(text)&&/No error has been found/.test(text);
    const violated=/Invariant\s+\S+\s+is violated/.test(text);
    if(completed) return {tool_outcome:"MODEL_CHECKED",test_verdict:positive&&exit===0?"PASS":"INCONCLUSIVE"};
    if(violated) return {tool_outcome:"INVARIANT_VIOLATED",test_verdict:!positive&&exit!==0?"PASS":"INCONCLUSIVE"};
    return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
  }
  if (tool==="apalache") {
    const noError=/The outcome is: NoError/.test(text);
    const foundError=/The outcome is: Error/.test(text);
    if(noError) return {tool_outcome:"NO_ERROR",test_verdict:positive&&exit===0?"PASS":"INCONCLUSIVE"};
    if(foundError) return {tool_outcome:"ERROR_FOUND",test_verdict:!positive&&exit!==0?"PASS":"INCONCLUSIVE"};
    return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
  }
  if (tool==="alloy") {
    if(exit!==0) return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
    // The alloy dispatcher prints "<n>. check <Name> ... UNSAT|SAT" result lines (observed on stderr).
    const lines=[...text.matchAll(/^\s*\d+\.\s+check\s+\S+\s.*\b(UNSAT|SAT)\s*$/gm)];
    if(!lines.length) return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
    const violated=lines.some(m=>m[1]==="SAT");
    return {tool_outcome:violated?"SAT":"UNSAT",test_verdict:(positive?!violated:violated)?"PASS":"INCONCLUSIVE"};
  }
  if (tool==="prob") {
    const violated=/COUNTER\s+EXAMPLE\s+FOUND/.test(text);
    const clean=/No counter example found/i.test(text);
    const kind=/invariant_violation/i.test(text)?"INVARIANT_VIOLATION":/deadlock/i.test(text)?"DEADLOCK":null;
    if(clean) return {tool_outcome:"NO_COUNTEREXAMPLE",test_verdict:positive&&exit===0?"PASS":"INCONCLUSIVE"};
    if(violated) return {tool_outcome:kind??"COUNTEREXAMPLE",test_verdict:!positive&&kind==="INVARIANT_VIOLATION"?"PASS":"INCONCLUSIVE"};
    return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
  }
  // Any further tool-specific parser must be validated against real receipts first.
  return {tool_outcome:"UNPARSED",test_verdict:"INCONCLUSIVE"};
}
export async function runFixture(tool,which,timeout=30) {
  assertTool(tool);assertTimeout(timeout);
  if (!["positive","negative"].includes(which)) throw new TypeError("case must be positive/negative");
  // Only regular files are fixture inputs; tools may leave artifact directories
  // (e.g. TLC 2.19 states/<timestamp>/ beside the spec) in the examples folder.
  const inputs=(await readdir(file("skills",tool,"examples"),{withFileTypes:true})).filter(d=>d.isFile()).map(d=>d.name);
  const input_sha256=Object.fromEntries(await Promise.all(inputs.map(async n=>[n,sha(await readFile(fixture(tool,n)))])));
  const dir=await mkdtemp(join(tmpdir(),"formal-js-"));
  try {
    let commandsToRun;
    try {commandsToRun=commands(tool,which,dir);}
    catch(e){return {tool,case:which,run_status:"NOT_RUN",tool_outcome:"ERROR",test_verdict:"INCONCLUSIVE",claim_verdict:"NOT_EVALUATED",error:String(e)};}
    await mkdir(dir,{recursive:true});
    const steps=[];
    for(const argv of commandsToRun) {
      const result=await capture(argv,{cwd:dir,timeoutMs:timeout*1000});
      steps.push(result);
      if (result.error||result.timed_out||result.output_truncated||result.exit_code!==0) break;
    }
    let extra={};
    if (tool==="souffle"&&steps[0]?.exit_code===0) {
      const read=async n=>(await readFile(join(dir,n),"utf8")).split(/\r?\n/).filter(Boolean);
      extra={cycle:await read("cycle.csv").catch(()=>null),reach:await read("reach.csv").catch(()=>null)};
    }
    const result=interpret(tool,which,steps,extra);
    return {tool,case:which,run_status:steps.some(x=>!x.error)?"EXECUTED":"NOT_RUN",
      ...result,claim_verdict:"NOT_EVALUATED",input_sha256,executions:steps,
      scope:"committed fixture only; not a proof of a project requirement"};
  } finally {
    await rm(dir,{recursive:true,force:true});
    // TLC writes an empty states/<timestamp>/ dir and ProB writes counterexample *.prob
    // traces next to the fixture files; remove those runner-produced artifacts.
    if(tool==="tla-tlc") await rm(file("skills","tla-tlc","examples","states"),{recursive:true,force:true});
    if(tool==="prob"){
      for(const name of await readdir(file("skills","prob","examples"))){
        if(name.endsWith(".prob")) await rm(file("skills","prob","examples",name),{force:true});
      }
    }
  }
}

/**
 * Host-process adapter for CLI-produced native plans.
 * All launchers are fixed by the tool catalog; arguments never reach a shell.
 * "raw" is a trusted local CLI capability, never exported as an MCP action.
 */
const TOOL_CLASSES=Object.freeze({
 tlc:"tlc2.TLC",sany:"tla2sany.SANY",pcal:"pcal.trans",
 "xml-exporter":"tla2sany.xml.XMLExporter"
});
function nativeCommand(plan) {
 const {entry,args}=plan;
 const known=describeNativeTool(plan.tool);
 if(!known.entries.includes(entry)) throw new TypeError("native entry not registered for "+plan.tool);
 if(!Array.isArray(args)||args.some(x=>typeof x!=="string"||x.includes("\0")))
   throw new TypeError("invalid native argv");
 if(Object.hasOwn(TOOL_CLASSES,entry)) {
   const jar=process.env.TLA2TOOLS_JAR;
   if(!jar)throw new TypeError("TLA2TOOLS_JAR missing");
   return [executable("java"),"-cp",resolve(jar),TOOL_CLASSES[entry],...args];
 }
 if(entry==="clingo"||entry==="pyshacl")return [
   process.env[entry==="clingo"?"FORMAL_CLINGO_PYTHON":"FORMAL_PYSHACL_PYTHON"]||"python3",
   "-m",entry,...args
 ];
 if(entry==="alloy"){
   if(process.env.FORMAL_ALLOY_JAR)
     return [executable("java"),"-jar",resolve(process.env.FORMAL_ALLOY_JAR),...args];
   if(process.env.FORMAL_ALLOY_BIN)
     return [resolve(process.env.FORMAL_ALLOY_BIN),...args];
   throw new TypeError("Alloy Analyzer can be confused with Grafana Alloy: configure FORMAL_ALLOY_JAR or FORMAL_ALLOY_BIN");
 }
 // The tool ID/entry combination was validated in native-catalog.mjs.
 return [executable(entry),...args];
}
export function interpretNativeObservation(tool,stdout,stderr,exitCode) {
 const output=(stdout+"\n"+stderr).trim();
 let outcome="UNPARSED";
 if(tool==="z3"||tool==="cvc5"){
   const m=[...output.matchAll(/^\s*(sat|unsat|unknown)\s*$/gm)];
   outcome=m.at(-1)?.[1].toUpperCase()??"UNPARSED";
 } else if(tool==="clingo") {
   outcome=/(?:^|\n)UNSATISFIABLE\s*$/m.test(output)?"UNSATISFIABLE":
           /(?:^|\n)SATISFIABLE\s*$/m.test(output)?"SATISFIABLE":"UNPARSED";
 } else if(tool==="vampire") {
   outcome=output.match(/SZS status ([A-Za-z]+)/)?.[1]?.toUpperCase()??"UNPARSED";
 } else if(tool==="rdf-shacl") {
   outcome=output.match(/Conforms:\s*(True|False)/i)?.[1]?.toUpperCase()??"UNPARSED";
 }
 return {tool_outcome:outcome,
   process_outcome:exitCode===0?"EXIT_ZERO":exitCode===null?"NOT_STARTED":"NONZERO_EXIT",
   test_verdict:"NOT_EVALUATED",
   claim_verdict:"NOT_EVALUATED",
   note:"Native command output only; solver result is not an acceptance verdict"};
}
export async function executeNativePlan(plan,{cwd=process.cwd(),timeout=30,allowRaw=false}={}) {
 if(!plan||typeof plan!=="object")throw new TypeError("invalid plan");
 if(plan.mode==="LOCAL_CLI_ONLY"&&!allowRaw)
   throw new TypeError("raw native pass-through is disabled for this caller");
 if(!["LOCAL_CLI_ONLY","LOCAL_CLI","typed"].includes(plan.mode))
   throw new TypeError("unsupported plan mode");
 if(!Number.isInteger(timeout)||timeout<1||timeout>120)throw new TypeError("timeout must be 1..120 s");
 const argv=nativeCommand(plan);
 const receipt=await capture(argv,{cwd:resolve(cwd),timeoutMs:timeout*1000});
 const observed=interpretNativeObservation(plan.tool,receipt.stdout,receipt.stderr,receipt.exit_code);
 return {tool:plan.tool,operation:plan.operation,mode:plan.mode,
   run_status:receipt.error?"NOT_RUN":"EXECUTED",...observed,
   ...(receipt.timed_out||receipt.output_truncated?{
     process_outcome:receipt.timed_out?"TIMEOUT":"OUTPUT_LIMIT",
     test_verdict:"INCONCLUSIVE"
   }:{}),
   executions:[receipt],scope:"local native CLI; not an independently validated project claim"};
}
