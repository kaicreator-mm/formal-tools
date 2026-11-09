/**
 * Full-surface native CLI routing without reimplementing 13 proof engines.
 * Pure JS: deterministic planning, input validation, and curated operation catalog.
 * Only a trusted local CLI may use nativeRaw(); MCP must NOT expose it.
 * Exact upstream flags remain discoverable with --help and pass-through.
 */
const string = (label,value) => {
  if (typeof value !== "string" || !value.length || value.includes("\0")) throw new TypeError(label+" must be nonempty text without NUL");
  return value;
};
const str = (flag) => ({flag,type:"string"});
const flag = (f) => ({flag:f,type:"bool"});
const integer = (f,min=0,max=1000000) => ({flag:f,type:"integer",min,max});
const choice = (f,values) => ({flag:f,type:"enum",values});
const operation = (entry,head=[],files=[],options={},tail=[]) => ({entry,head,files,options,tail});
const REGISTRY = {
 lean4:{
  title:"Lean 4 + Lake",source:"https://lean-lang.org/doc/reference/latest/Build-Tools-and-Distribution/Lake/",
  entries:["lean","lake"], help:{entry:"lake",args:["--help"]},
  operations:{
   check:operation("lean",[],["input"]),
   build:operation("lake",["build"],[],{target:str(""),package:str("--package")}),
   test:operation("lake",["test"]),
   lint:operation("lake",["lint"]),
   "check-build":operation("lake",["check-build"]),
   "check-test":operation("lake",["check-test"]),
   "check-lint":operation("lake",["check-lint"]),
   "query":operation("lake",["query"],[],{target:str("")})
  }
 },
 z3:{
  title:"Z3",source:"https://github.com/Z3Prover/z3",
  entries:["z3"],help:{entry:"z3",args:["-h"]},
  operations:{
   solve:operation("z3",["-smt2"],["input"],{timeout:integer("-T:",1,120000),seed:integer("sat.random_seed=",0,2147483647)}),
   "dimacs":operation("z3",["-dimacs"],["input"],{timeout:integer("-T:",1,120000)})
  }
 },
 cvc5:{
  title:"cvc5",source:"https://cvc5.github.io/docs/latest/options.html",
  entries:["cvc5"],help:{entry:"cvc5",args:["--help"]},
  operations:{
   solve:operation("cvc5",["--lang","smt2"],["input"],{models:flag("--produce-models"),cores:flag("--produce-unsat-cores"),proofs:flag("--produce-proofs"),tlimit:integer("--tlimit=",1,120000)}),
   sygus:operation("cvc5",["--lang","sygus2"],["input"],{tlimit:integer("--tlimit=",1,120000)})
  }
 },
 "tla-tlc":{
  title:"TLA+ tools: TLC, SANY, PlusCal, XMLExporter",source:"https://github.com/tlaplus/tlaplus/blob/master/USE.md",
  entries:["tlc","sany","pcal","xml-exporter"],help:{entry:"tlc",args:["-help"]},
  operations:{
   check:operation("tlc",[],["input"],{config:str("-config"),workers:integer("-workers",1,128),depth:integer("-depth",1,100000),dump_trace:str("-dumpTrace")}),
   simulate:operation("tlc",["-simulate"],["input"],{config:str("-config"),depth:integer("-depth",1,100000),seed:integer("-seed",0,2147483647)}),
   parse:operation("sany",[],["input"]),
   pluscal:operation("pcal",[],["input"]),
   xml:operation("xml-exporter",[],["input"])
  }
 },
 apalache:{
  title:"Apalache",source:"https://apalache-mc.org/docs/apalache/running.html",
  entries:["apalache-mc"],help:{entry:"apalache-mc",args:["--help"]},
  operations:{
   check:operation("apalache-mc",["check"],["input"],{length:integer("--length=",0,100000),init:str("--init="),next:str("--next="),inv:str("--inv="),solver:choice("--smt-solver=",["z3","cvc5"]),output:str("--out-dir=")}),
   parse:operation("apalache-mc",["parse"],["input"],{output:str("--output=")}),
   typecheck:operation("apalache-mc",["typecheck"],["input"]),
   simulate:operation("apalache-mc",["simulate"],["input"],{length:integer("--length=",0,100000),runs:integer("--max-run=",1,100000)}),
   test:operation("apalache-mc",["test"],["input"],{length:integer("--length=",0,100000)})
  }
 },
 alloy:{
  title:"Alloy Analyzer 6",source:"https://github.com/AlloyTools/org.alloytools.alloy/releases",
  entries:["alloy"],help:{entry:"alloy",args:["help"]},
  operations:{
   exec:operation("alloy",["exec"],["input"],{command:integer("-c",0,10000),solver:str("-s")}),
   help:operation("alloy",["help"]),
   lsp:operation("alloy",["lsp"])
  }
 },
 souffle:{
  title:"Soufflé Datalog",source:"https://souffle-lang.github.io/execute",
  entries:["souffle"],help:{entry:"souffle",args:["--help"]},
  operations:{
   run:operation("souffle",[],["input"],{facts:str("-F"),output:str("-D"),jobs:integer("-j",1,128),profile:str("-p"),debug:str("-r")}),
   compile:operation("souffle",["-c"],["input"],{facts:str("-F"),output:str("-D"),jobs:integer("-j",1,128)}),
   generate:operation("souffle",[],["input"],{target:str("-g"),jobs:integer("-j",1,128)}),
   parse:operation("souffle",["--parse-errors"],["input"])
  }
 },
 "rdf-shacl":{
  title:"pySHACL",source:"https://github.com/RDFLib/pySHACL",
  entries:["pyshacl"],help:{entry:"pyshacl",args:["--help"]},
  operations:{
   validate:operation("pyshacl",[],["input"],{shapes:str("-s"),ontology:str("-e"),inference:choice("-i",["none","rdfs","owlrl","both"]),format:choice("-f",["human","table","turtle","xml","json-ld","nt","n3"]),meta:flag("-m"),advanced:flag("-a"),abort:flag("--abort"),output:str("-o")})
  }
 },
 vampire:{
  title:"Vampire theorem prover",source:"https://github.com/vprover/vampire",
  entries:["vampire"],help:{entry:"vampire",args:["--show_options","on"]},
  operations:{
   prove:operation("vampire",[],["input"],{mode:choice("--mode",["casc","casc_sat","portfolio"]),proof:choice("--proof",["tptp","off"])}),
   "casc":operation("vampire",["--mode","casc"],["input"]),
   "casc-sat":operation("vampire",["--mode","casc_sat"],["input"])
  }
 },
 clingo:{
  title:"Clingo ASP",source:"https://potassco.org/clingo/",
  entries:["clingo"],help:{entry:"clingo",args:["--help=3"]},
  operations:{
   solve:operation("clingo",[],["input"],{models:integer("--models=",0,1000000),format:choice("--outf=",["0","1","2","3"]),opt:choice("--opt-mode=",["opt","enum","optN","ignore"]),time:integer("--time-limit=",1,120000)}),
   ground:operation("clingo",["--mode=gringo"],["input"]),
   "solve-json":operation("clingo",["--outf=2"],["input"],{models:integer("--models=",0,1000000)})
  }
 },
 "apache-jena":{
  title:"Apache Jena",source:"https://jena.apache.org/documentation/tools/",
  entries:["riot","arq","sparql","qparse","uparse","update","turtle","ntriples","nquads"],help:{entry:"riot",args:["--help"]},
  operations:{
   validate:operation("riot",["--validate"],["input"]),
   convert:operation("riot",[],["input"],{format:str("--output=")}),
   query:operation("arq",[],[],{data:str("--data"),query:str("--query"),format:str("--results=")}),
   parsequery:operation("qparse",[],[],{input:str("--file")}),
   parseupdate:operation("uparse",[],[],{input:str("--file")}),
   "update":operation("update",[],[],{data:str("--data"),input:str("--update")})
  }
 },
 prob:{
  title:"ProB",source:"https://prob.cs.uni-duesseldorf.de/w/index.php?title=Using_the_Command-Line_Version_of_ProB",
  entries:["probcli"],help:{entry:"probcli",args:["--help"]},
  operations:{
   check:operation("probcli",[],["input"],{bounded:integer("-mc",1,10000000)},["-model_check"]),
   "bounded":operation("probcli",[],["input"],{states:integer("-mc",1,10000000)}),
   animate:operation("probcli",[],["input"],{steps:integer("-execute",1,100000)}),
   "no-deadlock":operation("probcli",[],["input"],{},["-model_check","-nodead"])
  }
 },
 dafny:{
  title:"Dafny",source:"https://dafny.org/dafny/DafnyRef/DafnyRef",
  entries:["dafny"],help:{entry:"dafny",args:["--help"]},
  operations:{
   verify:operation("dafny",["verify"],["input"]),
   resolve:operation("dafny",["resolve"],["input"]),
   build:operation("dafny",["build"],["input"]),
   run:operation("dafny",["run"],["input"]),
   test:operation("dafny",["test"],["input"]),
   "format-check":operation("dafny",["format","--check"],["input"]),
   "format-print":operation("dafny",["format","--print"],["input"])
  }
 }
};
/** Operator-provided names are not executable names; only known entry keys are accepted. */
export const toolIds=Object.freeze(Object.keys(REGISTRY));
export function describeNativeTool(tool){
 if(!Object.hasOwn(REGISTRY,tool))throw new TypeError("unknown tool "+String(tool));
 const record=REGISTRY[tool];
 return {id:tool,title:record.title,entries:[...record.entries],
   operations:Object.fromEntries(Object.entries(record.operations).map(([k,v])=>[k,
     {entry:v.entry,required:[...v.files],options:Object.fromEntries(Object.entries(v.options).map(([name,opt])=>[name,{type:opt.type,values:opt.values??null,min:opt.min??null,max:opt.max??null}]))}])),
   documentation:record.source,coverage:"named operations + full native CLI pass-through; native runtime NOT_RUN"};
}
function encodeOpt(name,definition,val){
 if(definition.type==="bool"){if(typeof val!=="boolean")throw new TypeError("flag "+name+" must be boolean");return val?[definition.flag]:[];}
 if(definition.type==="integer"){if(!Number.isInteger(val)||val<definition.min||val>definition.max)throw new TypeError("invalid number for "+name);}
 if(definition.type==="enum"&&!definition.values.includes(String(val)))throw new TypeError("invalid enum "+name);
 if(definition.type==="string")string(name,val);
 const text=String(val);
 if(!definition.flag)return [text];
 if(definition.flag.endsWith("=")||definition.flag.endsWith(":"))return [definition.flag+text];
 return [definition.flag,text];
}
/** Plan only: does not launch subprocess or read files. */
export function planNative(tool,op,settings={}){
 if(!Object.hasOwn(REGISTRY,tool))throw new TypeError("unknown tool "+String(tool));
 const spec=REGISTRY[tool].operations[op];
 if(!spec)throw new TypeError("unknown operation "+String(op)+" for "+tool);
 if(!settings||typeof settings!=="object"||Array.isArray(settings))throw new TypeError("settings must be a JSON object");
 const permissible=new Set([...spec.files,...Object.keys(spec.options)]);
 for(const name of Object.keys(settings))if(!permissible.has(name))throw new TypeError("unknown option "+name+" for "+tool+"/"+op);
 const filePaths=spec.files.map(name=>string(name,settings[name]));
 const argumentsList=[...spec.head];
 for(const [name,def] of Object.entries(spec.options)){
   if(settings[name]!==undefined)argumentsList.push(...encodeOpt(name,def,settings[name]));
 }
 if(tool==="prob"&&op==="check"&&settings.bounded!==undefined) {
   // -mc <n> is bounded and must not be followed by unbounded -model_check.
   return {tool,operation:op,entry:spec.entry,args:[...filePaths,...argumentsList],mode:"typed",runtime:"NOT_RUN"};
 }
 // ProB expects input filename before switches; Jena query uses explicit --data/--query.
 const args=tool==="prob"
   ?[...filePaths,...argumentsList,...spec.tail]
   :[...argumentsList,...filePaths,...spec.tail];
 return {tool,operation:op,entry:spec.entry,args,mode:"typed",runtime:"NOT_RUN"};
}
/** Local trusted CLI only. Do NOT expose raw arguments via MCP. */
export function planRawNative(tool,entry,args){
 if(!Object.hasOwn(REGISTRY,tool))throw new TypeError("unknown tool");
 if(!REGISTRY[tool].entries.includes(entry))throw new TypeError("unknown entry for "+tool);
 if(!Array.isArray(args)||args.length>256||args.some(x=>typeof x!=="string"||x.includes("\0")))throw new TypeError("invalid native argument array");
 return {tool,operation:"raw",entry,args:[...args],mode:"LOCAL_CLI_ONLY",runtime:"NOT_RUN"};
}
/** Engine-native --help is always authoritative for this installed binary/version. */
export function planNativeHelp(tool,entry){
 if(!Object.hasOwn(REGISTRY,tool))throw new TypeError("unknown tool");
 if(entry===undefined)return {tool,operation:"help",entry:REGISTRY[tool].help.entry,args:[...REGISTRY[tool].help.args],mode:"LOCAL_CLI",runtime:"NOT_RUN"};
 const k=string("entry",entry);
 if(!REGISTRY[tool].entries.includes(k))throw new TypeError("unknown entry");
 const flagMap={tlc:"-help",sany:"-help",pcal:"-help","xml-exporter":"-help",alloy:"help",lake:"--help",lean:"--help",vampire:"--show_options",clingo:"--help=3",z3:"-h",probcli:"--help"};
 return {tool,operation:"help",entry:k,args:k==="vampire"?["--show_options","on"]:[flagMap[k]??"--help"],mode:"LOCAL_CLI",runtime:"NOT_RUN"};
}
