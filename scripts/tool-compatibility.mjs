#!/usr/bin/env node
/**
 * Read-only tool compatibility report. Takes local, explicitly supplied
 * observation data. Never installs or runs upstream engines.
 */
import {readFile} from "node:fs/promises";
import {buildCompatibilityMatrix} from "../packages/runner/js/compatibility-matrix.mjs";

async function main(argv){
  const [sha,flag,file,...extra]=argv;
  if(extra.length||(flag!==undefined&&flag!=="--observations")||
    (flag==="--observations"&&!file)||(!flag&&file))
    throw new TypeError("Usage: tool-compatibility.mjs <FULL_GIT_SHA> [--observations FILE.json]");
  let observations=[];
  if(flag==="--observations"){
    const text=await readFile(file,"utf8");
    if(text.length>2*1024*1024)throw new RangeError("observations JSON file too large");
    const raw=JSON.parse(text);
    observations=Array.isArray(raw)?raw:raw?.observations;
    if(!Array.isArray(observations))
      throw new TypeError("observations document must be a JSON array or {observations:[]}");
  }
  const matrix=buildCompatibilityMatrix({targetHead:sha,observations});
  process.stdout.write(JSON.stringify(matrix,null,2)+"\n");
}
try{await main(process.argv.slice(2));}
catch(e){process.stderr.write(String(e.message)+"\n");process.exitCode=2;}
