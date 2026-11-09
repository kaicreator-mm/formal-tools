import test from "node:test";
import assert from "node:assert/strict";
import { solveCnf, analyzeDag } from "../packages/core/src/finite.mjs";

let seed=240517;
function rand(){
  seed^=seed<<13;
  seed^=seed>>>17;
  seed^=seed<<5;
  return (seed>>>0)/4294967296;
}
function bruteSat(variables,clauses){
  for(let mask=0;mask<(1<<variables);mask++){
    const satisfied=clauses.every(clause=>
      clause.some(lit=>Boolean(mask&(1<<(Math.abs(lit)-1)))===(lit>0))
    );
    if(satisfied)return true;
  }
  return false;
}
function kahnHasCycle(nodes,edges){
  const indegree=new Map(nodes.map(v=>[v,0]));
  const out=new Map(nodes.map(v=>[v,[]]));
  for(const [from,to] of edges){
    indegree.set(to,indegree.get(to)+1);
    out.get(from).push(to);
  }
  const q=nodes.filter(v=>indegree.get(v)===0);
  let visited=0;
  while(q.length){
    const n=q.shift();
    visited++;
    for(const to of out.get(n)){
      indegree.set(to,indegree.get(to)-1);
      if(indegree.get(to)===0)q.push(to);
    }
  }
  return visited!==nodes.length;
}
test("1,200 seeded CNF formulas agree with independent exhaustive enumeration",()=>{
  for(let i=0;i<1200;i++){
    const variables=Math.floor(rand()*5);
    const clauses=Array.from({length:Math.floor(rand()*7)},()=>{
      const length=variables?Math.floor(rand()*4):0;
      return Array.from({length},()=>{
        const n=1+Math.floor(rand()*variables);
        return rand()<0.5?n:-n;
      });
    });
    const actual=solveCnf({variables,clauses}).tool_outcome;
    const expected=bruteSat(variables,clauses)?"SAT":"UNSAT";
    assert.equal(actual,expected,JSON.stringify({variables,clauses}));
  }
});
test("500 seeded DAGs agree with independent Kahn algorithm; witnesses are real arcs",()=>{
  for(let i=0;i<500;i++){
    const nodes=["A","B","C","D"],edges=[];
    for(const from of nodes)for(const to of nodes)if(rand()<0.22)edges.push([from,to]);
    const observed=analyzeDag({nodes,edges});
    assert.equal(observed.tool_outcome==="CYCLE_FOUND",kahnHasCycle(nodes,edges));
    if(observed.cycle){
      for(let k=1;k<observed.cycle.length;k++)
        assert.ok(edges.some(e=>e[0]===observed.cycle[k-1]&&e[1]===observed.cycle[k]));
    }
  }
});
