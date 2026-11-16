import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const spec = readFileSync(resolve("portable/builders/tools/rdf-shacl.sh"), "utf8");
const pins = readFileSync(resolve("portable/builders/tools/rdf-shacl.requirements.txt"), "utf8");
const expect = readFileSync(resolve("portable/verification/cases/rdf-shacl/expect.sh"), "utf8");

test("rdf-shacl builder enforces the exact pySHACL dependency closure", () => {
  const dependencies = pins.split("\n").filter(line => line && !line.startsWith("#"));
  assert.deepEqual(dependencies, [
    "pyshacl==0.40.2",
    "owlrl==7.6.2",
    "rdflib==7.6.0",
    "pyparsing==3.3.3",
    "html5rdf==1.2.1",
    "packaging==26.3",
    "prettytable==3.18.0",
    "wcwidth==0.9.4",
  ]);
  assert.match(spec, /rdf-shacl\.requirements\.txt/);
  assert.match(spec, /metadata\.version\(name\)/);
  assert.match(spec, /dependency mismatch/);
});

test("rdf-shacl portable verification has typed positive, violation and invalid-RDF cases", () => {
  for (const phase of ["POS", "NEG", "ERR"]) {
    assert.match(expect, new RegExp(`EXPECT_${phase}_ARGS=`));
    assert.match(expect, new RegExp(`EXPECT_${phase}_REGEX=`));
    assert.match(expect, new RegExp(`EXPECT_${phase}_LABEL=`));
  }
  assert.match(expect, /Conforms: True/);
  assert.match(expect, /Conforms: False/);
  assert.match(expect, /EXPECT_NEG_EXIT=1/);
  assert.match(expect, /EXPECT_ERR_EXIT=1/);
  assert.match(expect, /BadSyntax/);
  assert.match(expect, /INVALID_RDF/);
  const invalid = readFileSync(resolve("portable/verification/cases/rdf-shacl/err.ttl"), "utf8");
  assert.match(invalid, /"unterminated/);
});

test("current metadata generator emits canonical rdf-shacl TOOL_ID", { skip: process.platform !== "linux" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ft-rdf-shacl-meta-"));
  try {
    const generated = spawnSync("python3", [resolve("portable/builders/make_meta.py"), dir], {
      encoding: "utf8",
      env: {
        ...process.env,
        M_TOOL_ID: "rdf-shacl",
        M_TOOL_VERSION: "0.40.2",
        M_TOOL_KIND: "python-lib",
        M_BUILD_TS: "2026-11-15T00:00:00Z",
      },
    });
    assert.equal(generated.status, 0, generated.stderr);
    const shell = readFileSync(join(dir, "meta.sh"), "utf8");
    assert.match(shell, /^TOOL_ID=rdf-shacl$/m);
    assert.doesNotMatch(shell, /^TOOL_TOOL_ID=/m);
    const metadata = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    assert.equal(metadata.tool_id, "rdf-shacl");
    assert.equal(metadata.version, "0.40.2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
