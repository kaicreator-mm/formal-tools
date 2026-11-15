import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root="portable/verification/cases/prob/";
const contract=readFileSync(root+"expect.sh","utf8");
const field=name=>{
  const match=contract.match(new RegExp("^"+name+"=(.*)$","m"));
  assert.ok(match,name+" must be declared");
  return match[1].replace(/^['"]|['"]$/g,"");
};

test("ProB POS/NEG/ERR contract pins actual exit codes and typed outcomes",()=>{
  assert.equal(field("EXPECT_POS_EXIT"),"0");
  assert.equal(field("EXPECT_NEG_EXIT"),"0");
  assert.equal(field("EXPECT_ERR_EXIT"),"0");
  assert.match(field("EXPECT_POS_REGEX"),/^ALL OPERATIONS COVERED$/);
  assert.match(field("EXPECT_NEG_REGEX"),/^COUNTER EXAMPLE FOUND$/);
  assert.equal(field("EXPECT_ERR_REGEX"),"source: parse_error");
  assert.doesNotMatch(contract,/^EXPECT_(?:NEG|ERR)_EXIT=\*$/m);
});

test("ProB model files are copied to writable FT_TMP before model checking",()=>{
  assert.equal(field("EXPECT_SETUP_VIA"),"sh");
  const setup=field("EXPECT_SETUP_ARGS");
  const commands=setup.split(";").map(command=>command.trim());
  assert.deepEqual(commands,[
    "cp $BUNDLE/tests/prob/pos.mch $FT_TMP/pos.mch",
    "cp $BUNDLE/tests/prob/neg.mch $FT_TMP/neg.mch",
    "cp $BUNDLE/tests/prob/err.mch $FT_TMP/err.mch"
  ]);
  for(const name of ["pos","neg","err"]){
    assert.match(field("EXPECT_"+name.toUpperCase()+"_ARGS"),new RegExp("\\$FT_TMP/"+name+"\\.mch"));
  }
});

test("ProB fixtures represent distinct property, counterexample and parser-error cases",()=>{
  const pos=readFileSync(root+"pos.mch","utf8");
  const neg=readFileSync(root+"neg.mch","utf8");
  const err=readFileSync(root+"err.mch","utf8");
  assert.match(pos,/INVARIANT x : NAT/);
  assert.match(pos,/OPERATIONS[\s\S]*set = BEGIN x := 2 END/);
  assert.match(neg,/INVARIANT x : NAT/);
  assert.match(neg,/INITIALISATION x := -1/);
  assert.match(err,/VARIABLES x x/);
});
