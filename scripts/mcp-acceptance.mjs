import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Real MCP stdio acceptance for the 9 registered tools. Speaks newline-delimited
 * JSON-RPC to a spawned packages/runner/js/mcp.mjs child — no SDK client shortcut,
 * so the handshake exercises the same transport an external MCP host would use.
 * Read-only plus registered-tool calls only; never opens a raw shell channel.
 * Writes a receipt JSON and exits 0 only when every assertion holds.
 */
const here=dirname(fileURLToPath(import.meta.url));
const receiptOut=resolve(process.argv[2]||"validation/local-runtime-receipts");
const server=resolve(here,"../packages/runner/js/mcp.mjs");

const EXPECTED_TOOLS=[
  "list_formal_tools","validate_formal_source","inspect_formal_tool",
  "probe_formal_tool","run_formal_fixture","describe_native_cli",
  "inspect_native_installation","plan_native_cli","verify_formal_model"
].sort();

const child=spawn(process.execPath,[server],{stdio:["pipe","pipe","pipe"]});
const pending=new Map();
let nextId=1;
const stderrTail=[];
const transcript=[];

child.stdout.setEncoding("utf8");
let buffer="";
child.stdout.on("data",chunk=>{
  buffer+=chunk;
  let idx;
  while((idx=buffer.indexOf("\n"))>=0){
    const line=buffer.slice(0,idx).trim();
    buffer=buffer.slice(idx+1);
    if(!line)continue;
    let msg;
    try{msg=JSON.parse(line);}catch{transcript.push({unparseable:line.slice(0,200)});continue;}
    transcript.push({inbound:msg});
    if(msg.id!==undefined&&pending.has(msg.id)){
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data",c=>{
  for(const line of c.split("\n"))if(line.trim())stderrTail.push(line.slice(0,300));
});

function request(method,params,timeoutMs=20000){
  const id=nextId++;
  const frame=JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n";
  transcript.push({outbound:{id,method}});
  return new Promise((ok,fail)=>{
    const timer=setTimeout(()=>fail(new Error(`timeout waiting for ${method} (id=${id})`)),timeoutMs);
    pending.set(id,msg=>{clearTimeout(timer);ok(msg);});
    child.stdin.write(frame);
  });
}
function notify(method,params){
  transcript.push({outbound:{notification:method}});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",method,params})+"\n");
}
const firstText=result=>{
  const block=result?.content?.find(b=>b.type==="text");
  if(!block)return undefined;
  try{return JSON.parse(block.text);}catch{return block.text;}
};

const findings=[];
const check=(name,pass,detail="")=>{
  findings.push({name,pass,detail:String(detail).slice(0,400)});
  process.stdout.write(`${pass?"PASS":"FAIL"}  ${name}${detail?" — "+detail:""}\n`);
};

const calls={};
try{
  const init=await request("initialize",{
    protocolVersion:"2025-06-18",capabilities:{},
    clientInfo:{name:"formal-mcp-acceptance",version:"1.0.0"}
  });
  const serverName=init.result?.serverInfo?.name;
  check("initialize handshake",init.result?.serverInfo?.name==="formal-tools-skill",
    `serverInfo=${JSON.stringify(init.result?.serverInfo)} protocol=${init.result?.protocolVersion}`);
  calls.initialize={serverInfo:init.result?.serverInfo,protocolVersion:init.result?.protocolVersion};
  notify("notifications/initialized");

  const list=await request("tools/list",{});
  const names=(list.result?.tools??[]).map(t=>t.name).sort();
  check("tools/list exposes exactly the 9 registered tools",
    JSON.stringify(names)===JSON.stringify(EXPECTED_TOOLS),names.join(","));
  const toolMeta={};
  for(const t of list.result?.tools??[])toolMeta[t.name]=t.inputSchema;
  calls.tools_list=names;

  // The new read-only inspection tool must not accept any execution-shaped argument.
  const inspectSchema=JSON.stringify(toolMeta.inspect_native_installation);
  check("inspect_native_installation input schema is tool-only (no shell/argv/cwd passthrough)",
    /"tool"/.test(inspectSchema)&&!/shell|argv|command|cwd|args/.test(inspectSchema),inspectSchema.slice(0,200));

  const call=async(name,arguments_,timeoutMs=20000)=>{
    const resp=await request("tools/call",{name,arguments:arguments_},timeoutMs);
    calls[name]={arguments:arguments_,isError:resp.result?.isError===true,
      result:firstText(resp.result),error:resp.error?.message};
    return resp;
  };

  const listRes=await call("list_formal_tools",{});
  const listed=firstText(listRes.result);
  check("list_formal_tools reports 13 native tools",(listed?.native?.length??0)===13,
    `native=${listed?.native?.length} pure=${JSON.stringify(listed?.pure)}`);

  const valRes=await call("validate_formal_source",{});
  check("validate_formal_source returns STATIC_PASS",firstText(valRes.result)?.status==="STATIC_PASS",
    firstText(valRes.result)?.status);

  const inspRes=await call("inspect_formal_tool",{tool:"z3"});
  check("inspect_formal_tool describes z3",(firstText(inspRes.result)?.id??"")==="z3",
    JSON.stringify(firstText(inspRes.result)).slice(0,120));

  const probeRes=await call("probe_formal_tool",{tool:"z3",timeout_s:5});
  const probe=firstText(probeRes.result);
  check("probe_formal_tool fails closed without fabricating a version",
    probe?.run_status==="NOT_RUN"&&!probe?.version,JSON.stringify(probe).slice(0,160));

  const fixRes=await call("run_formal_fixture",{tool:"z3",case:"positive",timeout_s:15});
  const fix=firstText(fixRes.result);
  check("run_formal_fixture records honest non-PASS when binary missing",
    fix?.test_verdict!=="PASS",JSON.stringify({test_verdict:fix?.test_verdict,tool_status:fix?.tool_status}).slice(0,160));

  const descRes=await call("describe_native_cli",{tool:"z3"});
  check("describe_native_cli returns operations",Object.keys(firstText(descRes.result)?.operations??{}).length>0,
    `operations=${Object.keys(firstText(descRes.result)?.operations??{}).join(",")}`);

  const instRes=await call("inspect_native_installation",{tool:"z3"});
  const inst=firstText(instRes.result);
  check("inspect_native_installation is read-only (probe_status NOT_RUN, no execution)",
    instRes.result?.isError!==true&&inst?.probe_status==="NOT_RUN"&&!inst?.executions,
    JSON.stringify({status:inst?.status,probe_status:inst?.probe_status}).slice(0,160));

  const planRes=await call("plan_native_cli",{tool:"z3",operation:"solve",settings:{input:"skills/z3/examples/positive.smt2"}});
  const plan=firstText(planRes.result);
  check("plan_native_cli validates settings and returns argv without executing",
    Array.isArray(plan?.args)&&plan?.runtime==="NOT_RUN",JSON.stringify(plan).slice(0,160));

  const {readFile}=await import("node:fs/promises");
  const model=JSON.parse(await readFile(resolve(here,"../validation/js/dag-positive.json"),"utf8"));
  const pureRes=await call("verify_formal_model",{engine:"dag",model});
  const pure=firstText(pureRes.result);
  check("verify_formal_model really verifies the DAG model in pure JS",
    pure?.test_verdict==="PASS"&&pure?.execution==="PURE_JS",
    JSON.stringify(pure).slice(0,160));

  const badRes=await call("inspect_native_installation",{tool:"definitely-not-a-tool"});
  check("unknown tool id is rejected by schema (no generic executable)",
    badRes.result?.isError===true||Boolean(badRes.error),JSON.stringify(badRes.error??badRes.result?.content?.[0]?.text).slice(0,160));
}catch(e){
  check("driver completed without exception",false,String(e).slice(0,300));
}finally{
  try{notify("notifications/cancelled",{});}catch{}
  child.stdin.end();
  child.kill();
  await new Promise(ok=>{const t=setTimeout(ok,1000);child.once("exit",()=>{clearTimeout(t);ok();});});
}

const passed=findings.filter(f=>f.pass).length;
const receipt={
  schema:"formal-mcp-local-acceptance/1",
  written_at:new Date().toISOString(),
  transport:"stdio newline-delimited JSON-RPC",
  server:calls.initialize??null,
  tools:calls.tools_list??null,
  calls,
  assertions:findings,
  summary:{checks:findings.length,passed,failed:findings.length-passed},
  transcript,
  server_stderr_tail:stderrTail.slice(-10)
};
await mkdir(receiptOut,{recursive:true});
const receiptPath=resolve(receiptOut,"mcp-acceptance.json");
await writeFile(receiptPath,JSON.stringify(receipt,null,2)+"\n");
process.stdout.write(`receipt: ${receiptPath} — ${passed}/${findings.length} checks passed\n`);
process.exitCode=findings.every(f=>f.pass)?0:2;
