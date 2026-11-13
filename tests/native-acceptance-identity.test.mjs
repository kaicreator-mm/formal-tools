import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { binaryIdentity, checkoutIdentity, redactReceipt } from "../scripts/native-acceptance.mjs";

test("runtime receipt fingerprints file bytes, not just its name or version", async () => {
  const dir=await mkdtemp(join(tmpdir(),"formal-i4-identity-"));
  try {
    const path=join(dir,"tla2tools.jar");
    const bytes=Buffer.alloc(131073,0xa5);
    await writeFile(path,bytes);
    const identity=await binaryIdentity(path);
    assert.equal(identity.sha256,createHash("sha256").update(bytes).digest("hex"));
    assert.equal(identity.bytes,bytes.length);
    assert.match(identity.provenance,/supply-chain audit NOT performed/);
    await assert.rejects(binaryIdentity(dir),/regular file/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("runtime receipt identifies an actual Git checkout or explicitly abstains", () => {
  const identity=checkoutIdentity();
  assert.ok(["CLEAN","DIRTY","UNVERIFIED"].includes(identity.status));
  if(identity.status==="UNVERIFIED") assert.equal(identity.head_sha,null);
  else assert.match(identity.head_sha,/^[0-9a-f]{40}$/);
});

test("source SHA and JAR fingerprints survive privacy redaction, paths do not", () => {
  const source_identity={status:"CLEAN",head_sha:"a".repeat(40)};
  const safe=redactReceipt({source_identity,evidence:[{
    binary_identity:{path:"/opt/runtime/bin/java",sha256:"b".repeat(64)},
    dependency_identities:[{path:"/home/operator/bundles/tla2tools.jar",sha256:"c".repeat(64)}]
  }]});
  assert.deepEqual(safe.source_identity,source_identity);
  assert.equal(safe.evidence[0].binary_identity.sha256,"b".repeat(64));
  assert.equal(safe.evidence[0].dependency_identities[0].sha256,"c".repeat(64));
  assert.equal(safe.evidence[0].binary_identity.path,"…/runtime/bin/java");
  assert.equal(safe.evidence[0].dependency_identities[0].path,"…/operator/bundles/tla2tools.jar");
});
