import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
  assessWhy3EvidenceFreshness, IDENTITY_FIELDS, SOURCE_PIN_FIELDS,
  GATE_DEPENDENCIES, SOURCE_MAIN
} from "../scripts/tool-portfolio/why3-evidence-freshness.mjs";

const baseline = JSON.parse(readFileSync(
  new URL("../docs/tool-portfolio/r116/WHY3_T6_EVIDENCE_FRESHNESS.json",import.meta.url),"utf8"
));
const cli = fileURLToPath(new URL("../scripts/tool-portfolio/why3-evidence-freshness.mjs",import.meta.url));
const observe = () => ({toolId:"why3",identity:structuredClone(baseline.identity)});
function invoke(b,o) {
  const dir=mkdtempSync(join(tmpdir(),"why3-t6-cli-"));
  try {
    const a=join(dir,"baseline.json"),c=join(dir,"observed.json");
    writeFileSync(a,typeof b==="string"?b:JSON.stringify(b));
    writeFileSync(c,typeof o==="string"?o:JSON.stringify(o));
    return spawnSync(process.execPath,[cli,"--baseline",a,"--observed",c],{
      encoding:"utf8",timeout:10000
    });
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test("R27 baseline pins a real current-main source snapshot, but remains formally unqualified",()=>{
  assert.equal(baseline.sourceMain,SOURCE_MAIN);
  assert.equal(baseline.identity.version,"1.8.0");
  assert.equal(Object.keys(baseline.sourcePins).length,8);
  assert.deepEqual(Object.keys(baseline.identity),IDENTITY_FIELDS);
  for(const [path,field] of Object.entries(SOURCE_PIN_FIELDS)){
    assert.match(baseline.sourcePins[path],/^[a-f0-9]{40}$/);
    assert.equal(baseline.identity[field],baseline.sourcePins[path]);
  }
  assert.equal(baseline.identity.r27ArchiveSha256,"df2ef4b3378aa9559a50c051d677538dcc65496692b104c60ad3b807bbfb7268");
  assert.equal(baseline.identity.r27ReceiptBlob,"6f6c5613fcbc7439b93981b6b867fe340d0cf2f5");
  assert.match(baseline.evidenceLimitations.originalR23,/QUARANTINED/);
  assert.match(baseline.evidenceLimitations.driver,/UNKNOWN/);
  const r=assessWhy3EvidenceFreshness(baseline,observe());
  assert.equal(r.status,"FRESH_UNQUALIFIED");
  assert.deepEqual(r.revalidationGates,[]);
  assert.deepEqual(r.staleGates,[]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,false);
  assert.equal(r.qualificationGranted,false);
  assert.deepEqual(r.baselineUnknownFields,[
    "canonicalPublisherArchiveSha256","publisherSignatureVerified",
    "networkIsolationAttested","independentBusinessOracleId"
  ]);
});

test("all gate dependencies name known identities and T6 covers exactly all fields",()=>{
  const known=new Set(IDENTITY_FIELDS);
  assert.deepEqual(GATE_DEPENDENCIES.T6,IDENTITY_FIELDS);
  for(const [gate,fields] of Object.entries(GATE_DEPENDENCIES)){
    assert.equal(new Set(fields).size,fields.length,gate);
    assert.ok(fields.every(field=>known.has(field)),gate);
    assert.deepEqual(baseline.gateDependencies[gate],fields,gate);
  }
  assert.ok(GATE_DEPENDENCIES.T3.includes("r27ReceiptBlob"));
  assert.ok(GATE_DEPENDENCIES.T3.includes("r27ArchiveSha256"));
});

test("R27 receipt mutation invalidates dependent candidate gate routes without claiming a qualified T3",()=>{
  const o=observe();o.identity.r27ReceiptBlob="f".repeat(40);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.equal(r.status,"STALE_REVERIFY_REQUIRED");
  assert.deepEqual(r.revalidationGates,["T0","T3","T4","T6"]);
  assert.deepEqual(r.staleGates,[]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
  assert.equal(r.qualificationGranted,false);
});

test("raw R27 ZIP digest drift requires T3 and T4 review, never R23 resurrection",()=>{
  const o=observe();o.identity.r27ArchiveSha256="a".repeat(64);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T3","T4","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
  assert.equal(r.scopedR27EvidenceNeverPromoted,true);
  assert.match(r.limits,/R23 unsafe archive quarantined/);
});

test("R27 archive Git blob drift triggers the native evidence route",()=>{
  const o=observe();o.identity.r27ArchiveGitBlob="b".repeat(40);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T3","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
});

test("Z3 binary or shared library drift reopens T2 and T3 route checks",()=>{
  const o=observe();o.identity.z3SharedLibrarySha256="c".repeat(64);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T2","T3","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
});

test("manual Why3/Z3 driver configuration change requests limited new evidence only",()=>{
  const o=observe();o.identity.manualProverConfigSha256="a".repeat(64);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T3","T4","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
  assert.match(r.limits,/NEG was UNKNOWN/);
  assert.equal(r.qualificationGranted,false);
});

test("NEG input and case-output digests trigger scoped replay review but not a semantic Oracle",()=>{
  const o=observe();o.identity.negInputSha256="d".repeat(64);
  o.identity.negStdoutSha256="e".repeat(64);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T3","T5","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,true);
  assert.equal(r.qualificationGranted,false);
});

test("current Runner and gateway drift requires T4 only, not an invented retroactive R27 execution",()=>{
  const o=observe();o.identity.runnerBlob="f".repeat(40);
  o.identity.gatewayBlob="a".repeat(40);
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T4","T6"]);
  assert.equal(r.historicalR27EvidenceNeedsRecheck,false);
  assert.equal(r.qualificationGranted,false);
});

test("new publisher digest is a T0/T1 revalidation request, not automatic qualification",()=>{
  const o=observe();o.identity.canonicalPublisherArchiveSha256="b".repeat(64);
  o.identity.publisherSignatureVerified=true;
  const r=assessWhy3EvidenceFreshness(baseline,o);
  assert.deepEqual(r.revalidationGates,["T0","T1","T6"]);
  assert.equal(r.staleGates.length,0);
  assert.equal(r.qualificationGranted,false);
});

test("missing known R27 evidence, and a regression to null, fail closed",()=>{
  const missing=observe();delete missing.identity.r27ReceiptBlob;
  const a=assessWhy3EvidenceFreshness(baseline,missing);
  assert.equal(a.status,"INCOMPLETE_OBSERVATION");
  assert.deepEqual(a.missingFields,["r27ReceiptBlob"]);
  assert.deepEqual(a.revalidationGates,["T0","T3","T4","T6"]);
  assert.equal(a.historicalR27EvidenceNeedsRecheck,true);
  const nulled=observe();nulled.identity.r27ReceiptBlob=null;
  const b=assessWhy3EvidenceFreshness(baseline,nulled);
  assert.equal(b.status,"INCOMPLETE_OBSERVATION");
  assert.deepEqual(b.unknownFields,["r27ReceiptBlob"]);
  assert.equal(b.historicalR27EvidenceNeedsRecheck,true);
});

test("inherited baseline unknowns remain UNKNOWN but do not falsely make a baseline snapshot incomplete",()=>{
  const r=assessWhy3EvidenceFreshness(baseline,observe());
  assert.equal(r.status,"FRESH_UNQUALIFIED");
  assert.deepEqual(r.missingFields,[]);
  assert.deepEqual(r.unknownFields,[]);
  assert.ok(r.baselineUnknownFields.includes("networkIsolationAttested"));
});

test("malformed baseline source pins and extra/phantom dependency fields are rejected",()=>{
  const badPin=structuredClone(baseline);
  badPin.sourcePins["portable/builders/tools/why3.sh"]="f".repeat(40);
  assert.throws(()=>assessWhy3EvidenceFreshness(badPin,observe()),/source pin\/identity mismatch/);
  const ghost=structuredClone(baseline);
  ghost.gateDependencies.T3.push("historicR23NeverObservedSha256");
  assert.throws(()=>assessWhy3EvidenceFreshness(ghost,observe()),/unknown\/duplicate\/mismatched/);
  const missing=structuredClone(baseline);
  delete missing.identity.z3BinarySha256;
  assert.throws(()=>assessWhy3EvidenceFreshness(missing,observe()),/baseline identity field set/);
  const wrongSource=structuredClone(baseline);
  wrongSource.sourceMain="0".repeat(40);
  assert.throws(()=>assessWhy3EvidenceFreshness(wrongSource,observe()),/sourceMain mismatches/);
});

test("any attempt to mark historical R27 work as a fully qualified T3 is rejected",()=>{
  const b=structuredClone(baseline);b.gateStatus.T3="PASS_SCOPED";
  assert.throws(()=>assessWhy3EvidenceFreshness(b,observe()),/must not be promoted/);
  b.gateStatus.T3="NOT_QUALIFIED";
  b.qualificationGranted=true;
  assert.throws(()=>assessWhy3EvidenceFreshness(b,observe()),/qualification/);
});

test("wrong tool, invalid SHA and improper attestations never become freshness success",()=>{
  const wrong=observe();wrong.toolId="alloy";
  assert.throws(()=>assessWhy3EvidenceFreshness(baseline,wrong),/observation must identify Why3/);
  const badDigest=observe();badDigest.identity.r27ArchiveSha256="not-a-hash";
  assert.throws(()=>assessWhy3EvidenceFreshness(baseline,badDigest),/invalid SHA256/);
  const badStatus=observe();badStatus.identity.networkIsolationAttested="YES";
  assert.throws(()=>assessWhy3EvidenceFreshness(baseline,badStatus),/invalid attestation status/);
});

test("CLI returns 0 only for unqualified source freshness, 2 for drift or incomplete, 1 for malformed input",()=>{
  const fresh=invoke(baseline,observe());
  assert.equal(fresh.status,0,fresh.stderr);
  assert.equal(JSON.parse(fresh.stdout).status,"FRESH_UNQUALIFIED");
  const drift=observe();drift.identity.r27ReceiptBlob="e".repeat(40);
  const stale=invoke(baseline,drift);
  assert.equal(stale.status,2,stale.stderr);
  assert.equal(JSON.parse(stale.stdout).historicalR27EvidenceNeedsRecheck,true);
  const missing=observe();delete missing.identity.r27ReceiptBlob;
  const incomplete=invoke(baseline,missing);
  assert.equal(incomplete.status,2,incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).status,"INCOMPLETE_OBSERVATION");
  const invalid=invoke("{",observe());
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/why3-evidence-freshness:/);
});
