/**
 * Formal Tool Runner MCP via official TypeScript SDK v2.
 * Requires npm install; local stdio only. stdout reserved for MCP protocol.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { verifyPure } from "../../core/src/finite.mjs";
import { knownTools, validateSource, inspectTool, doctor, runFixture } from "./native.mjs";
import { describeNativeTool, planNative } from "./native-catalog.mjs";

const txt=x=>({content:[{type:"text",text:JSON.stringify(x)}]});
const handle=async callback=>{
  try{return txt(await callback());}
  catch(e){return {content:[{type:"text",text:JSON.stringify({status:"ERROR",message:String(e)})}],isError:true};}
};
const toolId=z.enum(["lean4","z3","tla-tlc","apalache","alloy","souffle","rdf-shacl","cvc5","vampire","clingo","apache-jena","prob","dafny"]);
serveStdio(()=>{
  const server=new McpServer({name:"formal-tools-skill",version:"0.3.0"});
  server.registerTool("list_formal_tools",{
    description:"List 13 native tools, 4 pure JS model checkers and source status.",
    inputSchema:z.object({})
  },async()=>txt({native:knownTools(),pure:["dag","writers","cnf","states"]}));
  server.registerTool("validate_formal_source",{
    description:"Validate Skill names and repository inputs; does NOT run proof engines.",
    inputSchema:z.object({})
  },async()=>handle(()=>validateSource()));
  server.registerTool("inspect_formal_tool",{
    description:"Describe registered native tool usage and positive/negative fixture expectations.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>inspectTool(tool)));
  server.registerTool("probe_formal_tool",{
    description:"Attempt a tool --version/--help via Node process, not a theorem proof.",
    inputSchema:z.object({tool:toolId,timeout_s:z.number().int().min(1).max(120).default(15)})
  },async({tool,timeout_s})=>handle(()=>doctor(tool,timeout_s)));
  server.registerTool("run_formal_fixture",{
    description:"Execute a fixed, committed tool fixture, not arbitrary shell or user code.",
    inputSchema:z.object({tool:toolId,case:z.enum(["positive","negative"]),timeout_s:z.number().int().min(1).max(120).default(30)})
  },async({tool,case:which,timeout_s})=>handle(()=>runFixture(tool,which,timeout_s)));
  server.registerTool("describe_native_cli",{
    description:"Describe a tool and its named CLI operations, without executing anything.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>describeNativeTool(tool)));
  server.registerTool("plan_native_cli",{
    description:"Validate native CLI option values, return planned argv; NO execution and NO raw passthrough.",
    inputSchema:z.object({tool:toolId,operation:z.string().min(1),settings:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({})})
  },async({tool,operation,settings})=>handle(()=>planNative(tool,operation,settings)));
  server.registerTool("verify_formal_model",{
    description:"Run real finite-model checks in pure JS: DAG, writer exclusivity, CNF or finite state.",
    inputSchema:z.object({engine:z.enum(["dag","writers","cnf","states"]),model:z.record(z.string(),z.unknown())})
  },async({engine,model})=>handle(()=>verifyPure(engine,model)));
  return server;
});
