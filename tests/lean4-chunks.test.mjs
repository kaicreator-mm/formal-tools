import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleVerifiedParts } from "../scripts/reassemble-lean4-chunks.mjs";

const sourceSha = (data) => createHash("sha256").update(data).digest("hex");

test("Lean4 transport manifest has exact, ordered five parts and original full digest", async () => {
  const data = JSON.parse(await readFile(new URL("../docs/tool-portfolio/r3/LEAN4_CHUNKS.json", import.meta.url), "utf8"));
  assert.equal(data.schema, "formal-tools/lean4-split-transport/1.0");
  assert.equal(data.parts.length, 5);
  assert.deepEqual(data.parts.map((p) => p.part_index), [0,1,2,3,4]);
  assert.deepEqual(data.parts.map((p) => p.expected_size_bytes),
    [134217728,134217728,134217728,134217728,30316953]);
  assert.equal(data.parts.reduce((sum,p) => sum + p.expected_size_bytes, 0), 567187865);
  assert.equal(data.original_archive_sha256, "671b172f8dacc4a7fd405852a2286e7657ec8c4414d301a73ece6f98f39bde62");
  assert.equal(data.reassembled_sha256_status, "NOT_RUN_EXECUTION_SERVICE_CLIENTERROR");
  assert.equal(data.original_tool_runner_verify_status, "NOT_RUN");
});

test("Lean4 assembler streams in fixed order, checks SHA, and rejects any mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ft-lean-parts-"));
  try {
    const blob = Buffer.from("source-bound-first-second-third-verified", "utf8");
    const pieces = [blob.subarray(0, 10), blob.subarray(10, 20), blob.subarray(20, 30), blob.subarray(30)];
    const specs = pieces.map((part, i) => ({
      part_index: i, file_name: `part-${i}`, expected_size_bytes: part.length
    }));
    for (let i=0; i<pieces.length; i++) await writeFile(join(dir,`part-${i}`), pieces[i]);
    const target = join(dir, "verified.tar.zst");
    const r = await assembleVerifiedParts({
      partsDir:dir, outputFile:target, parts:specs,
      expectedBytes:blob.length, expectedSha256:sourceSha(blob)
    });
    assert.equal(r.sha256, sourceSha(blob));
    assert.equal((await readFile(target)).toString("utf8"), blob.toString("utf8"));
    await assert.rejects(
      assembleVerifiedParts({partsDir:dir, outputFile:target, parts:specs,
        expectedBytes:blob.length, expectedSha256:sourceSha(blob)}),
      /EEXIST/);
    const bad = join(dir, "tampered.tar.zst");
    await writeFile(join(dir,"part-2"), Buffer.from("wrong_data")); // equal size to original only if length matches, else size rejection
    await assert.rejects(assembleVerifiedParts({partsDir:dir, outputFile:bad, parts:specs,
      expectedBytes:blob.length, expectedSha256:sourceSha(blob)}), /mismatched|SHA256/);
    await assert.rejects(stat(bad), {code:"ENOENT"});
    await assert.rejects(assembleVerifiedParts({partsDir:dir, outputFile:join(dir,"badsize"), parts:specs,
      expectedBytes:blob.length+1, expectedSha256:sourceSha(blob)}), /part sizes/);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});
