import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract=readFileSync("portable/verification/cases/fast-downward/expect.sh","utf8");
const malformed=readFileSync("portable/verification/cases/fast-downward/err.pddl","utf8");
const field=name=>{
  const match=contract.match(new RegExp("^"+name+"=(.*)$","m"));
  assert.ok(match, name+" must be declared");
  return match[1].replace(/^['"]|['"]$/g,"");
};

test("Fast Downward portable fixture pins POS, NEG and malformed-PDDL ERR exit codes",()=>{
  assert.match(field("EXPECT_POS_ARGS"),/domain\.pddl.*problem\.pddl.*astar/);
  assert.equal(field("EXPECT_POS_EXIT"),"0");
  assert.match(field("EXPECT_POS_REGEX"),/Solution found/);
  assert.match(field("EXPECT_NEG_ARGS"),/domain\.pddl.*unsolvable\.pddl.*astar/);
  assert.equal(field("EXPECT_NEG_EXIT"),"11");
  assert.match(field("EXPECT_NEG_REGEX"),/unsolvable|no solution|Completely explored/i);
  assert.match(field("EXPECT_ERR_ARGS"),/domain\.pddl.*err\.pddl.*astar/);
  assert.equal(field("EXPECT_ERR_EXIT"),"31");
  assert.match(field("EXPECT_ERR_REGEX"),/Could not parse problem file/);
  assert.match(field("EXPECT_ERR_LABEL"),/INVALID_PDDL_REJECTED/);
  assert.doesNotMatch(contract,/^EXPECT_(?:NEG|ERR)_EXIT=\*$/m);
  const opens=(malformed.match(/\(/g)||[]).length;
  const closes=(malformed.match(/\)/g)||[]).length;
  assert.ok(opens>closes,"ERR input must remain syntactically malformed");
});
