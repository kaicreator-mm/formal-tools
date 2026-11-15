import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const specPath = fileURLToPath(new URL("../portable/builders/tools/fast-downward.sh", import.meta.url));
const spec = readFileSync(specPath, "utf8");

test("Fast Downward source builder pins the declared 24.06 release to its official Git commit", () => {
  assert.match(spec, /^FT_TOOL_VERSION=24\.06$/m);
  assert.match(spec, /^FT_UPSTREAM_TAG=release-24\.06\.0$/m);
  assert.match(spec, /^FT_UPSTREAM_COMMIT=113fe1a626176f0c34888c645d4c25e7c31db372$/m);
  assert.match(spec, /git clone --depth 1 --branch "\$FT_UPSTREAM_TAG" --single-branch/);
  assert.match(spec, /git -C "\$src" rev-parse HEAD/);
  assert.match(spec, /grep -Fxq '__version__ = "24\.06"'/);
  assert.match(spec, /git_revision\.h/);
  assert.match(spec, /grep -Fq "\$FT_UPSTREAM_COMMIT" "\$revision_header"/);
  assert.match(spec, /^FT_PROBE=\(run --version\)$/m);
  assert.doesNotMatch(spec, /refs\/heads\/main|archive\/refs\/heads\/main|downward-main\.tar\.gz/);
  assert.doesNotMatch(spec, /sha256sum "\$tgz"/);
});

test("Fast Downward pinned source builder has valid Bash syntax", () => {
  const result = spawnSync("bash", ["-n", specPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
