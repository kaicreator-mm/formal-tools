#!/usr/bin/env node
/**
 * Why3 T6 candidate: compare a versioned, externally supplied identity
 * observation against the scoped R27 Git/receipt baseline.
 * This NEVER replays Why3, reconstructs the missing R23 bytes, or grants a gate.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const BASELINE_SCHEMA = "formal-tools/why3-t6-evidence-freshness-baseline/1.0";
export const ASSESSMENT_SCHEMA = "formal-tools/why3-t6-evidence-freshness-assessment/1.0";
export const SOURCE_MAIN = "6991c7aae1026ea9bda9d49f43139e92437f0493";
export const SOURCE_PIN_FIELDS = Object.freeze({
  "docs/tool-portfolio/r27/WHY3_R27_SCOPED_REPLAY.json": "r27ReceiptBlob",
  "docs/tool-portfolio/r27/WHY3_R27_VERIFICATION.zip": "r27ArchiveGitBlob",
  "portable/builders/tools/why3.sh": "builderBlob",
  "portable/verification/cases/why3/expect.sh": "expectBlob",
  "portable/verification/cases/why3/pos.mlw": "posFixtureBlob",
  "portable/verification/cases/why3/neg.mlw": "negFixtureBlob",
  "portable/packaging/bundle-template/bin/tool-runner": "runnerBlob",
  "packages/runner/js/tool-portfolio-t4.mjs": "gatewayBlob"
});
export const IDENTITY_FIELDS = Object.freeze([
  "version", "r27ReceiptBlob", "r27ArchiveGitBlob", "builderBlob", "expectBlob",
  "posFixtureBlob", "negFixtureBlob", "runnerBlob", "gatewayBlob",
  "r27ArchiveSha256", "candidateArchiveSha256", "why3BinarySha256",
  "z3BinarySha256", "z3SharedLibrarySha256", "manualProverConfigSha256",
  "posInputSha256", "negInputSha256", "errInputSha256",
  "posStdoutSha256", "negStdoutSha256", "errStderrSha256",
  "canonicalPublisherArchiveSha256", "publisherSignatureVerified",
  "networkIsolationAttested", "independentBusinessOracleId"
]);
export const GATE_DEPENDENCIES = Object.freeze({
  T0: Object.freeze(["version","candidateArchiveSha256","canonicalPublisherArchiveSha256","publisherSignatureVerified","r27ReceiptBlob"]),
  T1: Object.freeze(["version","builderBlob","candidateArchiveSha256","why3BinarySha256","canonicalPublisherArchiveSha256"]),
  T2: Object.freeze(["version","candidateArchiveSha256","why3BinarySha256","z3BinarySha256","z3SharedLibrarySha256","networkIsolationAttested"]),
  T3: Object.freeze(["version","r27ReceiptBlob","r27ArchiveGitBlob","r27ArchiveSha256","why3BinarySha256","z3BinarySha256","z3SharedLibrarySha256","manualProverConfigSha256","posFixtureBlob","negFixtureBlob","expectBlob","posInputSha256","negInputSha256","errInputSha256","posStdoutSha256","negStdoutSha256","errStderrSha256"]),
  T4: Object.freeze(["version","runnerBlob","gatewayBlob","expectBlob","r27ReceiptBlob","r27ArchiveSha256","why3BinarySha256","z3BinarySha256","manualProverConfigSha256"]),
  T5: Object.freeze(["version","why3BinarySha256","z3BinarySha256","posInputSha256","negInputSha256","independentBusinessOracleId"]),
  T6: IDENTITY_FIELDS
});
const QUALIFIED_STATES = new Set(["PASS", "PASS_SCOPED", "ACCEPTED_SCOPED", "MERGED_SCOPED"]);
const KNOWN_NULLS = new Set([
  "canonicalPublisherArchiveSha256", "publisherSignatureVerified",
  "networkIsolationAttested", "independentBusinessOracleId"
]);
const GIT_BLOB_FIELDS = new Set(Object.values(SOURCE_PIN_FIELDS));
const HEX_64_FIELDS = new Set([
  "r27ArchiveSha256","candidateArchiveSha256","why3BinarySha256",
  "z3BinarySha256","z3SharedLibrarySha256","manualProverConfigSha256",
  "posInputSha256","negInputSha256","errInputSha256",
  "posStdoutSha256","negStdoutSha256","errStderrSha256",
  "canonicalPublisherArchiveSha256"
]);
const HEX_SHA1 = /^[a-f0-9]{40}$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
const object = obj => obj !== null && typeof obj === "object" && !Array.isArray(obj);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function assertIdentityValue(field,value,isBaseline) {
  if (value === null) {
    if (isBaseline && !KNOWN_NULLS.has(field)) {
      throw new TypeError("known baseline identity unexpectedly null: " + field);
    }
    return;
  }
  if (GIT_BLOB_FIELDS.has(field)) {
    if (typeof value !== "string" || !HEX_SHA1.test(value)) {
      throw new TypeError("invalid Git Blob SHA for " + field);
    }
  } else if (HEX_64_FIELDS.has(field)) {
    if (typeof value !== "string" || !HEX_SHA256.test(value)) {
      throw new TypeError("invalid SHA256 for " + field);
    }
  } else if (field === "version") {
    if (typeof value !== "string" || !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(value)) {
      throw new TypeError("invalid Why3 version");
    }
  } else if (field === "publisherSignatureVerified" || field === "networkIsolationAttested") {
    if (typeof value !== "boolean") {
      throw new TypeError("invalid attestation status for " + field);
    }
  } else if (typeof value !== "string" || !value) {
    throw new TypeError("invalid identity value for " + field);
  }
}
function validateBaseline(b) {
  if (!object(b) || b.schema !== BASELINE_SCHEMA || b.toolId !== "why3") {
    throw new TypeError("invalid Why3 baseline schema/tool");
  }
  if (b.sourceMain !== SOURCE_MAIN || !object(b.identity) ||
      !equal(Object.keys(b.identity), IDENTITY_FIELDS)) {
    throw new TypeError("baseline identity field set or exact sourceMain mismatches");
  }
  for (const field of IDENTITY_FIELDS) {
    assertIdentityValue(field,b.identity[field],true);
  }
  if (!object(b.sourcePins) || !object(b.sourcePinFields)) {
    throw new TypeError("baseline sourcePins/sourcePinFields missing");
  }
  if (!equal(Object.keys(b.sourcePins).sort(),Object.keys(SOURCE_PIN_FIELDS).sort()) ||
      !equal(b.sourcePinFields,SOURCE_PIN_FIELDS)) {
    throw new TypeError("baseline source pin mapping mismatches");
  }
  for (const [path,field] of Object.entries(SOURCE_PIN_FIELDS)) {
    if (!HEX_SHA1.test(b.sourcePins[path]) || b.identity[field] !== b.sourcePins[path]) {
      throw new TypeError("baseline source pin/identity mismatch: " + path);
    }
  }
  if (!object(b.gateStatus) || !object(b.gateDependencies) ||
      !equal(Object.keys(b.gateStatus),Object.keys(GATE_DEPENDENCIES)) ||
      !equal(Object.keys(b.gateDependencies),Object.keys(GATE_DEPENDENCIES))) {
    throw new TypeError("baseline gate schemas mismatch");
  }
  const knownFields = new Set(IDENTITY_FIELDS);
  for (const [gate,dependencies] of Object.entries(GATE_DEPENDENCIES)) {
    if (!dependencies.length || new Set(dependencies).size !== dependencies.length ||
        dependencies.some(field => !knownFields.has(field))) {
      throw new TypeError("invalid executable dependency mapping for " + gate);
    }
    const raw = b.gateDependencies[gate];
    if (!Array.isArray(raw) || raw.some(field => !knownFields.has(field)) ||
        new Set(raw).size !== raw.length || !equal(raw,dependencies)) {
      throw new TypeError("unknown/duplicate/mismatched baseline gate dependency for " + gate);
    }
    if (typeof b.gateStatus[gate] !== "string" || !b.gateStatus[gate]) {
      throw new TypeError("invalid baseline gate status " + gate);
    }
  }
  if (Object.entries(b.gateStatus).some(([gate,status]) =>
      QUALIFIED_STATES.has(status))) {
    throw new TypeError("Why3 R27 technical replay must not be promoted to qualified lifecycle gate");
  }
  if (!Array.isArray(b.scopedR27EvidenceFields) ||
      !b.scopedR27EvidenceFields.length ||
      !b.scopedR27EvidenceFields.every(field => GATE_DEPENDENCIES.T3.includes(field))) {
    throw new TypeError("invalid R27 evidence field mapping");
  }
  if (!object(b.evidenceLimitations) || b.qualificationGranted !== false) {
    throw new TypeError("historical Why3 limitations/qualification must remain explicit");
  }
}

export function assessWhy3EvidenceFreshness(baseline,observed) {
  validateBaseline(baseline);
  if (!object(observed) || observed.toolId !== "why3" || !object(observed.identity)) {
    throw new TypeError("observation must identify Why3 with an identity object");
  }
  const missingFields=[], unknownFields=[], changedFields=[];
  for (const field of IDENTITY_FIELDS) {
    if (!own(observed.identity,field) || observed.identity[field] === undefined) {
      missingFields.push(field);
      continue;
    }
    const oldValue = baseline.identity[field], value = observed.identity[field];
    assertIdentityValue(field,value,false);
    if (value === null) {
      if (oldValue !== null) unknownFields.push(field);
    } else if (!equal(value,oldValue)) {
      changedFields.push({field,from:oldValue,to:value,resolvedPreviouslyUnknown:oldValue===null});
    }
  }
  const changedSet = new Set([...missingFields,...unknownFields,...changedFields.map(x=>x.field)]);
  const revalidationGates = Object.entries(GATE_DEPENDENCIES)
    .filter(([,fields]) => fields.some(field=>changedSet.has(field)))
    .map(([gate])=>gate);
  const staleGates = revalidationGates.filter(gate => QUALIFIED_STATES.has(baseline.gateStatus[gate]));
  const historicalR27EvidenceNeedsRecheck = baseline.scopedR27EvidenceFields
    .some(field => changedSet.has(field));
  const baselineUnknownFields = IDENTITY_FIELDS.filter(field => baseline.identity[field] === null);
  const status = missingFields.length || unknownFields.length ? "INCOMPLETE_OBSERVATION"
    : changedFields.length ? "STALE_REVERIFY_REQUIRED" : "FRESH_UNQUALIFIED";
  return {
    schema:ASSESSMENT_SCHEMA,toolId:"why3",sourceMain:SOURCE_MAIN,status,
    changedFields,missingFields,unknownFields,baselineUnknownFields,
    revalidationGates,staleGates,historicalR27EvidenceNeedsRecheck,
    scopedR27EvidenceNeverPromoted:true,qualificationGranted:false,
    limits:"R27 manual-driver nonroot chroot replay only; NEG was UNKNOWN(sat), not Invalid. R23 unsafe archive quarantined, historical bytes unrecovered. No publisher canonical proof, full T0–T6, network isolation, business Oracle, Product or Release admission."
  };
}

export async function runWhy3EvidenceFreshnessCli(argv=process.argv.slice(2)) {
  const args={};
  for (let i=0;i<argv.length;i++) {
    if (argv[i]==="--help") {
      process.stdout.write("Usage: why3-evidence-freshness.mjs --baseline file.json --observed file.json\n");
      return 0;
    }
    if (!["--baseline","--observed"].includes(argv[i]) || !argv[i+1] || argv[i+1].startsWith("--")) {
      throw new Error("expected --baseline and --observed file paths");
    }
    args[argv[i].slice(2)]=argv[++i];
  }
  if (!args.baseline || !args.observed) throw new Error("--baseline and --observed are required");
  const [baseline,observed]=await Promise.all([args.baseline,args.observed]
    .map(async file=>JSON.parse(await readFile(resolve(file),"utf8"))));
  const result=assessWhy3EvidenceFreshness(baseline,observed);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  return result.status==="FRESH_UNQUALIFIED" ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWhy3EvidenceFreshnessCli().then(rc=>{process.exitCode=rc;}).catch(error=>{
    process.stderr.write("why3-evidence-freshness: "+error.message+"\n");
    process.exitCode=1;
  });
}
