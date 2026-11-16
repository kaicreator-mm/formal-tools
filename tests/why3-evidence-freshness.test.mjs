import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
  assessWhy3EvidenceFreshness, IDENTITY_FIELDS, SOURCE_PIN_FIELDS,
  GATE_DEPENDENCIES, SOURCE_MAIN,
  REQUIRED_R27_EVIDENCE_FIELDS, BASELINE_GATE_STATUSES, PROVENANCE_BOUNDARY
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

test("truncated, extended, swapped or duplicated monitored R27 sets are rejected before any assessment",()=>{
  // Independent-review P1-01 counterexample: a nonempty T3 member subset that
  // used to pass validation while silencing the historical recheck flag.
  const drift=observe();drift.identity.r27ReceiptBlob="f".repeat(40);
  const subset=structuredClone(baseline);
  subset.scopedR27EvidenceFields=["version"];
  assert.throws(()=>assessWhy3EvidenceFreshness(subset,drift),
    /exactly match the 13 required monitored R27 identities/);
  const dropped=structuredClone(baseline);
  dropped.scopedR27EvidenceFields=baseline.scopedR27EvidenceFields
    .filter(field=>field!=="r27ArchiveSha256");
  assert.throws(()=>assessWhy3EvidenceFreshness(dropped,drift),
    /exactly match the 13 required monitored R27 identities/);
  const emptied=structuredClone(baseline);
  emptied.scopedR27EvidenceFields=[];
  assert.throws(()=>assessWhy3EvidenceFreshness(emptied,drift),
    /exactly match the 13 required monitored R27 identities/);
  const extended=structuredClone(baseline);
  extended.scopedR27EvidenceFields=[...baseline.scopedR27EvidenceFields,"runnerBlob"];
  assert.throws(()=>assessWhy3EvidenceFreshness(extended,drift),
    /exactly match the 13 required monitored R27 identities/);
  const swapped=structuredClone(baseline);
  swapped.scopedR27EvidenceFields=baseline.scopedR27EvidenceFields.map(
    field=>field==="errStderrSha256"?"expectBlob":field);
  assert.throws(()=>assessWhy3EvidenceFreshness(swapped,drift),
    /exactly match the 13 required monitored R27 identities/);
  const duplicated=structuredClone(baseline);
  duplicated.scopedR27EvidenceFields=[...baseline.scopedR27EvidenceFields];
  duplicated.scopedR27EvidenceFields[0]=duplicated.scopedR27EvidenceFields[1];
  assert.throws(()=>assessWhy3EvidenceFreshness(duplicated,drift),
    /exactly match the 13 required monitored R27 identities/);
  // Deletion plus disappearing (null) or absent observed receipt never yields
  // an accepted assessment with a falsely clear recheck flag.
  const nulled=observe();nulled.identity.r27ReceiptBlob=null;
  const absent=observe();delete absent.identity.r27ReceiptBlob;
  for(const o of [drift,nulled,absent]){
    assert.throws(()=>assessWhy3EvidenceFreshness(dropped,o),
      /exactly match the 13 required monitored R27 identities/);
  }
  // The same truncated baseline is rejected through the external --baseline CLI path.
  const viaCli=invoke(subset,drift);
  assert.equal(viaCli.status,1,viaCli.stderr);
  assert.equal(viaCli.stdout,"");
  assert.match(viaCli.stderr,/exactly match the 13 required monitored R27 identities/);
});

test("the frozen 13-field monitoring set drives the historical recheck flag for every member",()=>{
  assert.deepEqual([...REQUIRED_R27_EVIDENCE_FIELDS],baseline.scopedR27EvidenceFields);
  const blobFields=Object.values(SOURCE_PIN_FIELDS).map(value=>String(value));
  for(const field of REQUIRED_R27_EVIDENCE_FIELDS){
    const o=observe();
    o.identity[field]=blobFields.includes(field)?"f".repeat(40):"a".repeat(64);
    const r=assessWhy3EvidenceFreshness(baseline,o);
    assert.equal(r.status,"STALE_REVERIFY_REQUIRED",field);
    assert.equal(r.historicalR27EvidenceNeedsRecheck,true,field);
    assert.ok(r.revalidationGates.includes("T3"),field);
    assert.ok(r.revalidationGates.includes("T6"),field);
    assert.equal(r.qualificationGranted,false,field);
  }
});

test("promotion-like or arbitrary baseline gate statuses outside the pinned enum are rejected",()=>{
  assert.deepEqual([...BASELINE_GATE_STATUSES].sort(),
    ["CANDIDATE_ONLY","CHROOT_OBSERVED_ONLY","NOT_ACCEPTED","NOT_QUALIFIED","OPEN"]);
  for(const [gate,status] of [["T3","QUALIFIED"],["T6","ACCEPTED"],["T4","PENDING"]]){
    const b=structuredClone(baseline);
    b.gateStatus[gate]=status;
    assert.throws(()=>assessWhy3EvidenceFreshness(b,observe()),
      new RegExp(`invalid baseline gate status ${gate}`),`${gate}=${status}`);
  }
  for(const [gate,status] of [["T0","PASS"],["T5","PASS_SCOPED"],
      ["T2","ACCEPTED_SCOPED"],["T1","MERGED_SCOPED"]]){
    const b=structuredClone(baseline);
    b.gateStatus[gate]=status;
    assert.throws(()=>assessWhy3EvidenceFreshness(b,observe()),
      /must not be promoted/,`${gate}=${status}`);
  }
});

test("self-consistent pin/identity replacement stays value-only comparison with an explicit provenance boundary",()=>{
  // Documented P2-01 boundary: a self-consistent spoofed pin/identity pair is
  // not detected as Git drift by this value assessor; the result must instead
  // carry the unauthenticated-values boundary and never claim provenance proof.
  const spoofed=structuredClone(baseline);
  spoofed.sourcePins["portable/packaging/bundle-template/bin/tool-runner"]="9".repeat(40);
  spoofed.identity.runnerBlob="9".repeat(40);
  const spoofObserved={toolId:"why3",identity:structuredClone(spoofed.identity)};
  const r=assessWhy3EvidenceFreshness(spoofed,spoofObserved);
  assert.equal(r.status,"FRESH_UNQUALIFIED");
  assert.equal(r.qualificationGranted,false);
  assert.equal(r.provenanceBoundary,PROVENANCE_BOUNDARY);
  assert.match(r.provenanceBoundary,/UNAUTHENTICATED/);
  assert.match(r.provenanceBoundary,/NOT independent Git provenance verification/);
  const fresh=assessWhy3EvidenceFreshness(baseline,observe());
  assert.equal(fresh.provenanceBoundary,PROVENANCE_BOUNDARY);
});
