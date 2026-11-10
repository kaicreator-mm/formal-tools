import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {listTools,toolDetails,planTool,invokeStagedTool} from "../packages/runner/js/sdk.mjs";

test("monorepo runner exposes experimental SDK but keeps CLI binary intact",async()=>{
 const pkg=JSON.parse(await readFile(new URL("../packages/runner/package.json",import.meta.url),"utf8"));
 assert.equal(pkg.private,true);
 assert.equal(pkg.bin["formal-tools"],"./js/cli.mjs");
 assert.equal(pkg.exports["."].types,"./js/sdk.d.mts");
 assert.equal(pkg.exports["."].default,"./js/sdk.mjs");
 assert.deepEqual(pkg.exports["./sdk"],pkg.exports["."]);
});
test("public package SDK uses the same authoritative tool catalog",()=>{
 assert.equal(listTools().length,13);
 assert.equal(toolDetails("z3").id,"z3");
 assert.deepEqual(planTool("z3","solve",{input:"model.smt2"}).args,["-smt2","model.smt2"]);
 assert.equal(typeof invokeStagedTool,"function");
});
