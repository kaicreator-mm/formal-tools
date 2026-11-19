/**
 * Formal Tool Runner MCP via official TypeScript SDK v2.
 * Requires npm install; local stdio only. stdout reserved for MCP protocol.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { verifyPure } from "../../core/src/finite.mjs";
import { knownTools, validateSource, inspectTool, doctor, runFixture } from "./native.mjs";
import { describeNativeTool, planNative, toolIds } from "./native-catalog.mjs";
import { inspectInstallation } from "./tool-manager.mjs";
import { listPortfolioTools, describePortfolioTool, inspectPortfolioTool, runPortableGate, runPortfolioOperation } from "./tool-portfolio-t4.mjs";
import { matchValidatedTools, loadCapabilityValidation } from "./capability-validation.mjs";
import { planWorkflow } from "./sdk.mjs";

/** @typedef {{type:"text",text:string}} TextBlock */
/** @type {(x:unknown)=>{content:TextBlock[]}} */
const txt=x=>({content:[{type:"text",text:JSON.stringify(x)}]});
/** @type {(callback: ()=>unknown)=>Promise<{content:TextBlock[],isError?:boolean}>} */
const handle=async callback=>{
  try{return txt(await callback());}
  catch(e){return {content:[{type:"text",text:JSON.stringify({status:"ERROR",message:String(e)})}],isError:true};}
};
const candidateId=z.string().refine(value=>listPortfolioTools().some(t=>t.id===value&&t.origin==="candidate"),
  {message:"Unknown candidate tool or existing native tool; use the original native adapter"});
const portfolioId=z.string().refine(value=>listPortfolioTools().some(t=>t.id===value),
  {message:"Unknown portfolio tool"});
const toolId=z.string().refine(value=>toolIds.includes(value),{message:"Unknown registered formal tool"});
const highsModelSchema=z.object({
  sense:z.enum(["min","max"]),
  objective:z.array(z.number().finite()).min(1).max(64),
  variables:z.array(z.object({
    lower:z.number().finite().nullable(),upper:z.number().finite().nullable()
  }).strict()).min(1).max(64),
  constraints:z.array(z.object({
    lower:z.number().finite().nullable(),upper:z.number().finite().nullable(),
    coefficients:z.array(z.number().finite()).max(64)
  }).strict()).max(128)
}).strict();
serveStdio(()=>{
  const server=new McpServer({name:"formal-tools-skill",version:"0.4.0"});
  server.registerTool("list_formal_tools",{
    description:"List original 13 native adapters, 23 candidate portfolio tools, and 4 pure JS model checkers.",
    inputSchema:z.object({})
  },async()=>txt({native:knownTools(),portfolio:listPortfolioTools(),pure:["dag","writers","cnf","states"]}));
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
  server.registerTool("inspect_native_installation",{
    description:"Read-only installed executable/JAR discovery and missing dependency diagnostics. Does NOT launch native tools.",
    inputSchema:z.object({tool:toolId})
  },async({tool})=>handle(()=>inspectInstallation(tool)));
  server.registerTool("plan_native_cli",{
    description:"Validate native CLI option values, return planned argv; NO execution and NO raw passthrough.",
    inputSchema:z.object({tool:toolId,operation:z.string().min(1),settings:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({})})
  },async({tool,operation,settings})=>handle(()=>planNative(tool,operation,settings)));
  server.registerTool("list_portfolio_tools",{
    description:"Read-only capability and tool metadata for all 36 tools. Never implies a T3/T4/T5 PASS.",
    inputSchema:z.object({})
  },async()=>txt({tools:listPortfolioTools(),status:"DISCOVERY_NOT_T4_QUALIFIED"}));
  server.registerTool("match_formal_capabilities",{
    description:"Deterministic capability-ID to validated-tool match over the r176 container probe receipts. Read-only; capability IDs come from the frozen discovery registry. Probe receipts are technical evidence, never a T3/T4/T5/T6 or business acceptance.",
    inputSchema:z.object({
      capabilities:z.array(z.string().min(1)).min(1).max(16),
      include_not_verified:z.boolean().default(false)
    }).strict()
  },async({capabilities,include_not_verified})=>handle(async()=>{
    const match=matchValidatedTools(capabilities,{includeNotVerified:include_not_verified});
    const ledger=loadCapabilityValidation();
    return {...match,ledger_counts:ledger.counts,
      scope:"PROBE_RECEIPTS_ARE_TECHNICAL_EVIDENCE_ONLY_NOT_FORMAL_ACCEPTANCE"};
  }));
  server.registerTool("inspect_portfolio_tool",{
    description:"Read-only pinned portable installation metadata; no process launch.",
    inputSchema:z.object({tool:portfolioId})
  },async({tool})=>handle(()=>inspectPortfolioTool(tool)));
  server.registerTool("verify_portable_fixture",{
    description:"Run ONLY the candidate tool's committed portable pos/neg/err fixture through a SHA-pinned runner. No user input/raw argv/shell. Technical evidence only, not business verification.",
    inputSchema:z.object({tool:candidateId,timeout_s:z.number().int().min(1).max(120).default(120)})
  },async({tool,timeout_s})=>{
    const response=await handle(()=>runPortableGate(tool,{mode:"verify-fixture",timeoutS:timeout_s}));
    // A returned NOT_RUN/NOT_QUALIFIED is an MCP tool error, not a successful
    // native execution. Keep the technical receipt itself in the content.
    try{
      const receipt=JSON.parse(response.content[0]?.text??"{}");
      if(receipt.status!=="FIXTURE_TECHNICAL_PASS_UNREVIEWED")return {...response,isError:true};
    }catch{return {...response,isError:true};}
    return response;
  });
  server.registerTool("run_portfolio_operation",{
    description:"Run a registered typed candidate operation through the shared portfolio Runner. Currently only Highs 1.15.1 solve-lp is admitted; accepts a bounded LP model, never raw argv, shell, script path or arbitrary file input.",
    inputSchema:z.object({
      tool:z.literal("highs"),operation:z.literal("solve-lp"),model:highsModelSchema,
      timeout_s:z.number().int().min(1).max(30).default(30)
    }).strict()
  },async({tool,operation,model,timeout_s})=>{
    const response=await handle(()=>runPortfolioOperation(tool,operation,model,{timeoutS:timeout_s}));
    try{
      const receipt=JSON.parse(response.content[0]?.text??"{}");
      if(receipt.status!=="T4_OPERATION_EXECUTED_UNREVIEWED")return {...response,isError:true};
    }catch{return {...response,isError:true};}
    return response;
  });
  server.registerTool("verify_formal_model",{
    description:"Run real finite-model checks in pure JS: DAG, writer exclusivity, CNF or finite state.",
    inputSchema:z.object({engine:z.enum(["dag","writers","cnf","states"]),model:z.record(z.string(),z.unknown())})
  },async({engine,model})=>handle(()=>verifyPure(engine,model)));
  server.registerTool("plan_workflow",{
    description:"Plan a bounded user problem into a formal-tools/execution-plan/1.0 workflow (PLANNING ONLY - never executes anything; tool_execution stays NOT_RUN). Deterministic z3+cvc5 cross-check template by default; the canonical problem text is used verbatim as the SMT-LIB input of both solvers. Optional provider:'deepseek' replaces the template with ONE real DeepSeek method proposal using DEEPSEEK_API_KEY from the host environment (absent key fails closed with BLOCKED_PROVIDER; never mocked). Execution is intentionally NOT exposed over MCP: run the compiled plan on a trusted host via the SDK/CLI.",
    inputSchema:z.object({
      problem_text:z.string().min(1).max(65536),
      assumptions:z.array(z.string().max(512)).max(32).default([]),
      provider:z.enum(["deepseek"]).optional()
    }).strict()
  },async({problem_text,assumptions,provider})=>handle(async()=>{
    const {problem,plan}=await planWorkflow({problemText:problem_text,assumptions,provider});
    return {...plan,problem_id:problem.problem_id,tool_execution:"NOT_RUN"};
  }));
  return server;
});
