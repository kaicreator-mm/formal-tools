#!/usr/bin/env node
// This script is read-only, runs no native formal engine and has no network calls.
import { buildCompatibilityMatrix } from "../packages/runner/js/compatibility-matrix.mjs";
const sha=process.argv[2];
try{
  const matrix=buildCompatibilityMatrix({targetHead:sha});
  process.stdout.write(JSON.stringify(matrix,null,2)+"\n");
}catch(e){
  process.stderr.write(String(e.message)+"\n");
  process.exitCode=2;
}
