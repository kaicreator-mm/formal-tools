import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_BLOBS = {
  "portable/builders/tools/cbmc.sh": "da52ea3848ca4d83911ca1120756cbd8755c1106",
  "portable/builders/make_meta.py": "2e02fb79aed836ee6cd4698415af43b7cce44da6",
  "portable/packaging/bundle-template/bin/tool-runner": "102e971481a3e213fdb41fa45230b1dd3beaf2bd",
  "portable/verification/cases/cbmc/expect.sh": "b318da8edf58c691f643608e7591c81c07b45714",
  "portable/verification/cases/cbmc/pos.c": "1832fb133b10ffdb218be6a057f1a66213f03a63",
  "portable/verification/cases/cbmc/neg.c": "cb597185eb47d6bfffbe17ef6d6666a2e28a4dc3",
  "portable/verification/cases/cbmc/err.c": "7b93059ef1ba6f67e6bb923faaaa6f29407d7364",
  "tests/cbmc-upstream-source-pin.test.mjs": "499d8358be2eb28f3265e11af50d3b64e791c896",
  "packages/runner/js/tool-portfolio-t4.mjs": "922a7c208beaa0e48346403a29ec2d927189319f",
  "packages/runner/js/cli.mjs": "05a0693f1ab34a881c7fd8de81b3d609e6568047",
  "packages/runner/js/sdk.mjs": "774899d95911f9650f12f4de0dbfa38dc3f4d07d",
  "packages/runner/js/mcp.mjs": "27f654b99a49d86a148f4b86f01cf7b5b85c0754",
  "registry/PROBLEM_CAPABILITIES.json": "faa89997c3f7c8c71da0a69aa90e8ff37461cde0",
  "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json": "250b84ae0638d98115d748a32ae2f2c9357942b0",
  "package-lock.json": "2ad31f01195434617ac74d2f377287a15e062b95"
};

const gitBlob = bytes => createHash("sha1")
  .update(Buffer.from("blob " + bytes.length + "\0"))
  .update(bytes)
  .digest("hex");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  return { exit_code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("CBMC current-main source pins and legacy metadata fail-closed regression", async t => {
  const pins = {};
  for (const [path, expected] of Object.entries(SOURCE_BLOBS)) {
    const bytes = await readFile(join(ROOT, path));
    const actual = gitBlob(bytes);
    assert.equal(actual, expected, "source pin drift: " + path);
    pins[path] = actual;
  }

  const work = await mkdtemp(join(tmpdir(), "cbmc-meta-contract-"));
  try {
    const bundle = join(work, "portable");
    const toolDir = join(bundle, "tools", "cbmc");
    const runnerDir = join(bundle, "bin");
    const evidenceDir = join(bundle, "evidence");
    await mkdir(toolDir, { recursive: true });
    await mkdir(runnerDir, { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    const runner = join(runnerDir, "tool-runner");
    await copyFile(join(ROOT, "portable/packaging/bundle-template/bin/tool-runner"), runner);
    await chmod(runner, 0o755);

    const metaSh = join(toolDir, "meta.sh");
    await writeFile(metaSh, [
      "TOOL_TOOL_ID=cbmc",
      "TOOL_VERSION=6.11.0",
      "TOOL_KIND=binary",
      ""
    ].join("\n"));

    const inheritedAlias = run(runner, ["version", "cbmc"], {
      env: { ...process.env, TOOL_ID: "cbmc", FT_EVIDENCE_DIR: evidenceDir }
    });
    assert.equal(inheritedAlias.exit_code, 2);
    assert.match(inheritedAlias.stdout + inheritedAlias.stderr, /invalid tool metadata/);

    const generated = run("python3", [join(ROOT, "portable/builders/make_meta.py"), toolDir], {
      env: {
        ...process.env,
        M_TOOL_ID: "cbmc",
        M_TOOL_VERSION: "6.11.0",
        M_TOOL_KIND: "binary",
        M_BUILD_TS: "2026-11-16T00:00:00Z",
        M_UNAVAILABLE: "0"
      }
    });
    assert.equal(generated.exit_code, 0, generated.stdout + generated.stderr);
    const corrected = await readFile(metaSh, "utf8");
    assert.match(corrected, /^TOOL_ID=cbmc$/m);
    assert.doesNotMatch(corrected, /^TOOL_TOOL_ID=/m);

    const version = run(runner, ["version", "cbmc"], {
      env: { ...process.env, FT_EVIDENCE_DIR: evidenceDir }
    });
    assert.equal(version.exit_code, 0, version.stdout + version.stderr);
    assert.match(version.stdout, /tool: cbmc/);
    assert.match(version.stdout, /version: 6\.11\.0/);

    const unsafeId = run(runner, ["version", "../cbmc"], {
      env: { ...process.env, FT_EVIDENCE_DIR: evidenceDir }
    });
    assert.equal(unsafeId.exit_code, 2);
    assert.match(unsafeId.stdout + unsafeId.stderr, /invalid tool id/);

    t.diagnostic(JSON.stringify({
      current_main_source_pins: pins,
      legacy_metadata: { key: "TOOL_TOOL_ID", inherited_TOOL_ID_rejected: true, exit_code: inheritedAlias.exit_code },
      current_builder: { blob: SOURCE_BLOBS["portable/builders/make_meta.py"], output_key: "TOOL_ID", exit_code: generated.exit_code },
      runner_version: { exit_code: version.exit_code, stdout: version.stdout },
      unsafe_id: { exit_code: unsafeId.exit_code, stdout: unsafeId.stdout, stderr: unsafeId.stderr }
    }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
