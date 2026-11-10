import test from "node:test";
import assert from "node:assert/strict";
import { redactPath, redactString, redactReceipt } from "../scripts/native-acceptance.mjs";

test("redactPath keeps the evidential tail of local absolute paths",()=>{
  assert.equal(redactPath("C:\\Users\\tester\\AppData\\Local\\Temp\\formal-js-cKDmj0\\examples\\positive.smt2"),
    "…\\formal-js-cKDmj0\\examples\\positive.smt2");
  assert.equal(redactPath("C:\\Dev\\Code\\dx-service\\.venv\\bin\\z3.exe"),"…\\.venv\\bin\\z3.exe");
  assert.equal(redactPath("C:\\Dev\\Code\\dx-service\\.venv\\bin",2),"…\\.venv\\bin");
  assert.equal(redactPath("/home/cc/z3/build/z3"),"…\\z3\\build\\z3".replace(/\\/g,"/"));
  assert.equal(redactPath("-smt2"),"-smt2");
});

test("redactString scrubs drive-letter paths embedded in prose and error text",()=>{
  assert.equal(redactString("spawn C:\\Dev\\Code\\dx-service\\.venv\\bin\\cvc5 ENOENT"),
    "spawn …\\.venv\\bin\\cvc5 ENOENT");
  assert.equal(redactString("Z3 version 5.1.0 - 64 bit"),"Z3 version 5.1.0 - 64 bit");
  assert.equal(redactString("unsat"),"unsat");
});

test("redactReceipt removes hostname and metadata paths, keeps stdout verbatim",()=>{
  const receipt={
    host_identity:{hostname:"private-host",platform:"win32",release:"10.0.26300",arch:"x64",
      node:"v24.21.0",cpu:"Test CPU",tool_bin_dir:"C:\\Dev\\Code\\dx-service\\.venv\\bin"},
    evidence:[{tool:"z3",version:{argv:["C:\\Dev\\Code\\dx-service\\.venv\\bin\\z3","-version"],
      stdout:"Z3 version 5.1.0 - 64 bit\r\n",stdout_sha256:"abc",error:null},
      installation:{executable:"C:\\Dev\\Code\\dx-service\\.venv\\bin\\z3.exe",diagnostics:[]},
      binary_identity:{path:"C:\\Dev\\Code\\dx-service\\.venv\\bin\\z3.exe",sha256:"def"},
      positive:{executions:[{argv:["z3","-smt2","C:\\Users\\t\\Temp\\x\\examples\\positive.smt2"],
        stdout:"unsat\r\n"}]},
      extra_cases:{error_input:{error:"spawn C:\\x\\y\\cvc5 ENOENT"}}}]
  };
  const safe=redactReceipt(receipt);
  assert.equal(safe.host_identity.hostname,"REDACTED");
  assert.equal(safe.host_identity.platform,"win32");
  assert.equal(safe.host_identity.tool_bin_dir,"…\\dx-service\\.venv\\bin");
  assert.equal(safe.evidence[0].version.argv[0],"…\\.venv\\bin\\z3");
  assert.equal(safe.evidence[0].version.stdout,"Z3 version 5.1.0 - 64 bit\r\n");
  assert.equal(safe.evidence[0].installation.executable,"…\\.venv\\bin\\z3.exe");
  assert.equal(safe.evidence[0].binary_identity.path,"…\\.venv\\bin\\z3.exe");
  assert.equal(safe.evidence[0].positive.executions[0].argv[2],"…\\x\\examples\\positive.smt2");
  assert.equal(safe.evidence[0].extra_cases.error_input.error,"spawn …\\x\\y\\cvc5 ENOENT");
});

test("redactReceipt fails closed when a path survives in hash-anchored stdout",()=>{
  const receipt={evidence:[{tool:"z3",positive:{executions:[{stdout:"see C:\\Users\\leak\\file.smt2"}]}}]};
  assert.throws(()=>redactReceipt(receipt),/privacy invariant violated/);
  const scrubbed=redactReceipt({evidence:[{installation:{diagnostics:["run C:/Users/x/z3.exe"]}}]});
  assert.equal(scrubbed.evidence[0].installation.diagnostics[0],"run …/Users/x/z3.exe");
});
