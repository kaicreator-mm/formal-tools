import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PyMC T2 audit references the immutable receipt ZIP members, not missing repo paths", async () => {
  const audit = JSON.parse(await readFile(new URL("../docs/tool-portfolio/r50/PYMC_T0_SOURCE_AUDIT.json", import.meta.url), "utf8"));
  const archive = audit.original_portable_archive;
  const receipt = archive.safety_evidence.receipt_archive;
  assert.equal(receipt.drive_file_id, "1u-yzMMeWUOedqgzYY0eY5yGgkpu6DhRm");
  assert.equal(receipt.name, "PYMC_R55_T2_REPLAY_RECEIPTS.zip");
  assert.equal(receipt.size_bytes, 30421);
  assert.equal(receipt.sha256, "80a902e148ecc7dff43f1b447f688b1e2c1657dd625e585c645b2ef5431f7f68");
  assert.equal(receipt.internal_sha256sums_entries, 18);
  assert.equal(receipt.internal_sha256sums_verified, 18);

  const members = archive.tar_members;
  assert.equal(members.manifest_archive_member, "tar-members.json");
  assert.equal(members.manifest_encoding, "UTF-8 JSON; member of the immutable T2 receipt ZIP");
  assert.equal(members.manifest_uncompressed_size_bytes, 92163);
  assert.equal(members.manifest_uncompressed_sha256, "a9ee1149c87c84c713cbfd8b6f9267afc15b73849e5c04ba72eb21cf80566927");
  assert.equal(members.manifest_source.archive_entry, "tar-members.json");

  const extraction = archive.extraction;
  assert.equal(extraction.receipt_archive_member, "receipt.json");
  assert.equal(extraction.receipt_archive_drive_file_id, receipt.drive_file_id);
  assert.deepEqual(extraction.replay_log_archive_members, [
    "environment.txt", "source-sha256.txt", "manifest-entry.txt",
    "zstd-test.stdout", "zstd-test.stderr", "zstd-test.exit",
    "zstd-decompress.stderr", "zstd-decompress.exit", "archive-tar.sha256",
    "tar-listing.txt", "tar-listing.stderr", "tar-listing.exit",
    "extract.stdout", "extract.stderr", "extract.exit"
  ]);

  const serialized = JSON.stringify(audit);
  assert.doesNotMatch(serialized, /docs\/tool-portfolio\/r50\/evidence\/PYMC_T2_(?:EXTRACTION_RECEIPT|MEMBER_MANIFEST|REPLAY_LOG)/);
  assert.equal(archive.qualification.T2, "PASS_SCOPED_INDEPENDENT_ARCHIVE_INTEGRITY_TAR_PREFLIGHT_AND_NONROOT_EXTRACTION_ONLY");
  assert.equal(archive.qualification.T3, "NOT_RUN_ON_ORIGINAL_PORTABLE_BUNDLE");
  assert.equal(archive.qualification.T4, "BLOCKED_LEGACY_TOOL_TOOL_ID_METADATA");
});
