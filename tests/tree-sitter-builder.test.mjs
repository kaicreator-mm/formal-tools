import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const builder = await readFile(new URL("../portable/builders/tools/tree-sitter.sh", import.meta.url), "utf8");
const fixture = await readFile(new URL("../portable/verification/cases/tree-sitter/expect.sh", import.meta.url), "utf8");
const grammar = await readFile(new URL("../portable/verification/cases/tree-sitter/grammar.js", import.meta.url), "utf8");
const metadataGenerator = await readFile(new URL("../portable/builders/make_meta.py", import.meta.url), "utf8");

test("Tree-sitter rebuild pins both the official release asset and canonical executable", () => {
  assert.match(builder, /FT_TREE_SITTER_ARCHIVE_SHA256=7ed56d152c52437397b9fcaa43cf341f49933cecc1ca291843f0d347c6e2cb3a/);
  assert.match(builder, /FT_TREE_SITTER_CLI_SHA256=a658dfc7704d6595a3d2f50eba2590f5919ecd54beedf978ba9888ec914fec1f/);
  assert.match(builder, /gz=\$\(ft::fetch "\$FT_UPSTREAM_URL" "\$FT_TREE_SITTER_ARCHIVE_SHA256"\)/);
  assert.match(builder, /FT_TREE_SITTER_CLI_BIN/);
  assert.match(builder, /binary_sha_verified/);
  assert.match(builder, /version_output=\$\(/);
  assert.match(builder, /tree-sitter 0\.27\.2/);
});

test("Tree-sitter build and shim no longer require unavailable Python bindings or a bundled grammar cache", () => {
  assert.doesNotMatch(builder, /tree_sitter_language_pack|runtimes\/py-cache|PYTHONHOME|--py/);
  assert.match(builder, /FT_TMP\/tree-sitter-cache/);
  assert.match(builder, /exec "\$TOOL_DIR\/bin\/tree-sitter" "\$\@"/);
});

test("Tree-sitter fixed fixture uses native CLI setup, POS, NEG, and invalid-input ERR contracts", () => {
  for (const phase of ["SETUP", "POS", "NEG", "ERR"]) {
    assert.match(fixture, new RegExp("EXPECT_" + phase + "_VIA=run"));
  }
  assert.match(fixture, /--js-runtime native/);
  assert.match(fixture, /--output \$FT_TMP\/src/);
  assert.match(fixture, /--grammar-path \$FT_TMP/);
  assert.match(fixture, /EXPECT_POS_EXIT=0/);
  assert.match(fixture, /EXPECT_NEG_EXIT=1/);
  assert.match(fixture, /EXPECT_ERR_EXIT=1/);
  assert.match(fixture, /EXPECT_POS_REGEX=.*number/);
  assert.match(fixture, /EXPECT_NEG_REGEX=.*ERROR/);
  assert.match(fixture, /EXPECT_ERR_REGEX=.*No files were found/);
  assert.doesNotMatch(fixture, /_VIA=py|pos\.py|neg\.py/);
  assert.match(grammar, /name: 'numbers_demo'/);
  assert.match(grammar, /number: \$ => \/\[0-9\]\+\//);
});

test("canonical metadata generator emits the single TOOL_ID identity key", () => {
  assert.match(metadataGenerator, /\("tool_id",\s*"TOOL_ID"\)/);
});
