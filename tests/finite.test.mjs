import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDag, checkExclusiveWriters, solveCnf, verifyFiniteState, verifyPure } from "../packages/core/src/finite.mjs";

test("DAG accepts explicit acyclic graph",()=>assert.equal(analyzeDag({nodes:["A","B","C"],edges:[["A","B"],["B","C"]]}).tool_outcome,"ACYCLIC"));
test("DAG returns concrete cycle witness",()=>assert.deepEqual(analyzeDag({nodes:["A","B"],edges:[["A","B"],["B","A"]]}).cycle,["A","B","A"]));
test("DAG rejects dangling edges",()=>assert.throws(()=>analyzeDag({nodes:["A"],edges:[["A","B"]]})));
test("DAG rejects duplicate identities",()=>assert.throws(()=>analyzeDag({nodes:["A","A"],edges:[]})));
test("writer slots with no overlap are exclusive",()=>assert.equal(checkExclusiveWriters({claims:[{task:"a",resource:"x",slot:"1"},{task:"b",resource:"x",slot:"2"}]}).tool_outcome,"EXCLUSIVE"));
test("writer collision is a counterexample",()=>assert.equal(checkExclusiveWriters({claims:[{task:"a",resource:"x",slot:"1"},{task:"b",resource:"x",slot:"1"}]}).conflicts.length,1));
test("duplicate claim from same writer is not contention",()=>assert.equal(checkExclusiveWriters({claims:[{task:"a",resource:"x",slot:"1"},{task:"a",resource:"x",slot:"1"}]}).tool_outcome,"EXCLUSIVE"));
test("CNF can be satisfied",()=>assert.equal(solveCnf({variables:2,clauses:[[1,2],[-1,2]]}).tool_outcome,"SAT"));
test("CNF can be contradictory",()=>assert.equal(solveCnf({variables:1,clauses:[[1],[-1]]}).tool_outcome,"UNSAT"));
test("empty clause is unsatisfiable",()=>assert.equal(solveCnf({variables:0,clauses:[[]]}).tool_outcome,"UNSAT"));
test("zero variable empty formula is satisfiable",()=>assert.deepEqual(solveCnf({variables:0,clauses:[]}).model,[]));
test("CNF over bound is unknown rather than false pass",()=>assert.equal(solveCnf({variables:19,clauses:[[1]]}).tool_outcome,"UNKNOWN"));
test("finite state safe for listed reachable states",()=>assert.equal(verifyFiniteState({states:["idle","run"],initial:"idle",transitions:[["idle","run"]],allowedStates:["idle","run"]}).tool_outcome,"SAFE_FINITE"));
test("finite-state invariant returns witness trace",()=>assert.deepEqual(verifyFiniteState({states:["idle","run"],initial:"idle",transitions:[["idle","run"]],allowedStates:["idle"]}).path,["idle","run"]));
test("pure entrypoint rejects arbitrary engine",()=>assert.throws(()=>verifyPure("exec",{cmd:"echo"})));

test("CNF work budget yields UNKNOWN without false UNSAT",()=>{
  const heavy=Array.from({length:10000},()=>Array.from({length:18},(_,i)=>i+1));
  const result=solveCnf({variables:18,clauses:heavy});
  assert.equal(result.tool_outcome,"UNKNOWN");
  assert.equal(result.test_verdict,"INCONCLUSIVE");
});
