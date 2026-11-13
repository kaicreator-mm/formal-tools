/**
 * Read-only tool environment inspection. No downloads, installs, PATH writes, or
 * child processes. Actual version probes stay in native.mjs and are evidence-tagged.
 *
 * Every tool ID, launcher type, CLI entry and probe parameter comes from the
 * single native-catalog.mjs registry.
 */
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { posix, win32 } from "node:path";
import { toolIds, toolRuntimeProfile, planToolProbe } from "./native-catalog.mjs";

const pathFor = platform => platform==="win32"?win32:posix;
const readEnv = (env,key) => {
  const found=Object.keys(env).find(k=>k.toLowerCase()===key.toLowerCase());
  return found===undefined?undefined:env[found];
};
const separators = platform=>platform==="win32"?";":":";

/**
 * Return explicit, deterministic file probes. Never consult a caller's current
 * directory implicitly, and never claim version compatibility from a path hit.
 * @param {string} tool Registry tool ID.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 */
export function environmentSearchPlan(tool,{env={},platform="linux"}={}) {
  const toolProfile=toolRuntimeProfile(tool);
  const probe=planToolProbe(tool,env);
  if(probe.status==="NEEDS_CONFIGURATION")return {
    tool,kind:probe.launcher,status:"NEEDS_CONFIGURATION",
    missing:probe.missing,requiredFiles:[],candidates:[],
    diagnostics:["Set "+probe.missing.join(" or ")+" to the installed upstream tool location; no automatic install will occur"],
    probe:null
  };
  const pathLib=pathFor(platform);
  const exe=probe.argv[0];
  // Pinned binary launchers (clingo-bin) carry exactly one operator-configured
  // path: it is never re-resolved through PATH, and FORMAL_TOOLS_BIN_DIR must
  // not shadow it.
  const explicit=probe.launcher==="alloy-bin"||probe.launcher==="clingo-bin"||pathLib.isAbsolute(exe)||/[\\/]/.test(exe);
  const pref=env.FORMAL_TOOLS_BIN_DIR;
  // The existing runner applies FORMAL_TOOLS_BIN_DIR to native binaries and Java,
  // but not to the explicitly configured Python interpreter.
  const appliesBinDir=probe.launcher==="binary"||probe.launcher==="java-jar"||probe.launcher==="alloy-jar";
  const dirs=explicit?[]:appliesBinDir&&typeof pref==="string"&&pref.length
    ?[pref]
    :String(readEnv(env,"PATH")??"").split(separators(platform)).filter(Boolean);
  const ext=pathLib.extname(exe).toLowerCase();
  const suffixes=platform==="win32"&&!ext?[".exe",".com",".cmd",".bat",""] : [""];
  const bases=explicit?[exe]:dirs.map(dir=>pathLib.join(dir,exe));
  // A fixed executable path (or path relative to explicit cwd) is never
  // silently swapped for a different program on PATH.
  const candidates=[...new Set(bases.flatMap(base=>suffixes.map(s=>base+s)))];
  return {
    tool,kind:probe.launcher,status:"SEARCH_PENDING",requiredFiles:[...probe.requiredFiles],
    candidates,diagnostics:[],
    probe:{argv:[...probe.argv],helpSource:toolProfile.source}
  };
}
async function fileExists(path,platform,executable=true) {
  try {
    const info=await stat(path);
    if(!info.isFile())return false;
    await access(path,executable&&platform!=="win32"?constants.X_OK:constants.F_OK);
    return true;
  }catch{return false;}
}
/**
 * Check installation coordinates without launching the tool. A found command
 * means FOUND_NOT_PROBED, not VERIFIED or PASS.
 * Injecting exists supports deterministic tests on Windows and Linux.
 * @param {string} tool Registry tool ID.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   exists?: (path: string, executable?: boolean) => Promise<boolean>
 * }} [options]
 */
export async function inspectInstallation(tool,{env=process.env,platform=process.platform,exists}={}) {
  const check=exists??((p,exec=true)=>fileExists(p,platform,exec));
  const plan=environmentSearchPlan(tool,{env,platform});
  if(plan.status==="NEEDS_CONFIGURATION")return {
    tool,status:plan.status,launcher:plan.kind,missing:plan.missing,
    diagnostics:plan.diagnostics,probe_status:"NOT_RUN"
  };
  for(const dep of plan.requiredFiles) {
    if(!await check(dep,false))return {
      tool,status:"MISSING_DEPENDENCY_FILE",launcher:plan.kind,
      missing:[dep],diagnostics:["Configured dependency file is missing or unreadable: "+dep],
      probe_status:"NOT_RUN"
    };
  }
  const candidates=plan.candidates;
  let found=null;
  for(const p of candidates) if(await check(p,true)){found=p;break;}
  if(!found)return {
    tool,status:"MISSING_EXECUTABLE",launcher:plan.kind,
    diagnostics:[candidates.length
      ? "No matching executable found in the configured directory or PATH"
      : "No search directory configured; set PATH or FORMAL_TOOLS_BIN_DIR"],
    searched:candidates.length,probe_status:"NOT_RUN"
  };
  const suffix=platform==="win32"?win32.extname(found).toLowerCase():"";
  const wrapper=platform==="win32"&&[".bat",".cmd"].includes(suffix);
  // No shell:true fallback: a *.cmd wrapper is not a safe direct child_process
  // executable. Java tool vendors may supply a direct Java entrypoint instead.
  const diagnostics=wrapper
    ?["Windows script wrapper detected; direct spawn with shell:false is not supported. Configure a native executable or a verified Java entrypoint."]
    :[];
  if(plan.kind==="python-module")diagnostics.push("Python module presence is not checked by PATH inspection; run a real version probe");
  return {
    tool,status:wrapper?"WINDOWS_WRAPPER_UNSUPPORTED":"FOUND_NOT_PROBED",
    launcher:plan.kind,executable:found,
    argv:[found,...plan.probe.argv.slice(1)],
    diagnostics,probe_status:"NOT_RUN",searched:candidates.length
  };
}
export async function inspectAllInstallations(options={}) {
  const checks=[];
  for(const tool of toolIds)checks.push(await inspectInstallation(tool,options));
  const counts={};
  for(const c of checks)counts[c.status]=(counts[c.status]??0)+1;
  return {status:"STATIC_ENVIRONMENT_INSPECTION_ONLY",tools:checks.length,counts,checks};
}
export function toolInfo(tool) {
  return toolRuntimeProfile(tool);
}
