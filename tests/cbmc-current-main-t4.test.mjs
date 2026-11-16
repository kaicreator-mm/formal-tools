import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, mkdir, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURRENT_MAIN = "530a2d7a8edf99106845be228b6451c6aa52be92";
const ARCHIVE_ID = "11n3FyTfT_YXXdYgmWOsPB77e0LQpg7uX";
const ARCHIVE_SIZE = 20600381;
const ARCHIVE_SHA256 = "eaa049099a7a515631b4c82699b264e4bea1e677d9f65e8374cf212d30306369";
const UPSTREAM_DEB = { asset_id: 523196902, filename: "ubuntu-24.04-cbmc-6.11.0-Linux.deb", size: 73477756, sha256: "b3721aa541038384d7801ea3aeabbcddc3e8845ac8f1cbff637cf8dec7481ac8" };
const RUNNER_SHA256 = "020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a";
const ORIGINAL_META_SH_SHA256 = "72e74b130e631518223eb00d4123859d7d7032e2bdf9f6732858cab8e9de070d";
const GENERATED_META_SH_SHA256 = "f424b16e05f8abf91a713e0e40026431ccf71f540248cac9380f9eed48a52c5c";
const META_JSON_SHA256 = "f09b83bf3b6c1f8c4a586fa76dc7f759deedcc0dc0d50bb7e8902ed2f0748d76";
const FIXTURE_SHA256 = "f31f8f4fa90d6645c5d0a73bf9ec019e9a9cca9f04e1681f83af09513cf6282f";

const SOURCE_BLOBS = {
  "portable/builders/tools/cbmc.sh": "da52ea3848ca4d83911ca1120756cbd8755c1106",
  "portable/builders/make_meta.py": "2e02fb79aed836ee6cd4698415af43b7cce44da6",
  "portable/packaging/bundle-template/bin/tool-runner": "102e971481a3e213fdb41fa45230b1dd3beaf2bd",
  "portable/verification/cases/cbmc/expect.sh": "b318da8edf58c691f643608e7591c81c07b45714",
  "portable/verification/cases/cbmc/pos.c": "1832fb133b10ffdb218be6a057f1a66213f03a63",
  "portable/verification/cases/cbmc/neg.c": "cb597185eb47d6bfffbe17ef6d6666a2e28a4dc3",
  "portable/verification/cases/cbmc/err.c": "7b93059ef1ba6f67e6bb923faaaa6f29407d7364",
  "tests/cbmc-upstream-source-pin.test.mjs": "499d8358be2eb28f3265e11af50d3b64e791c896",
  "packages/runner/js/native-catalog.mjs": "02f628947be3e5c270d802be150ab220e14fc2b8",
  "packages/runner/js/native.mjs": "2e0e669e4fa66cb27654644705e76794c0727004",
  "packages/runner/js/tool-portfolio-t4.mjs": "922a7c208beaa0e48346403a29ec2d927189319f",
  "packages/runner/js/cli.mjs": "05a0693f1ab34a881c7fd8de81b3d609e6568047",
  "packages/runner/js/sdk.mjs": "774899d95911f9650f12f4de0dbfa38dc3f4d07d",
  "packages/runner/js/mcp.mjs": "27f654b99a49d86a148f4b86f01cf7b5b85c0754",
  "packages/runner/js/tool-manager.mjs": "a8e547718b8242c9d27f9e906b1c1ebaa2d80de6",
  "packages/runner/js/tool-workspace.mjs": "354809f169dac5b1fef31e64eb3aa7965ea0b88f",
  "packages/runner/js/artifact-collector.mjs": "8881dcb65f97f74036ad90e2ca01a600c2daaec8",
  "packages/runner/js/tool-result.mjs": "a2c61c50658fc3d7e578ffbf7ee018f707e15841",
  "packages/core/src/finite.mjs": "c717cb3b2eb4d13422fbdfb859aa3fcceee3851a",
  "registry/PROBLEM_CAPABILITIES.json": "faa89997c3f7c8c71da0a69aa90e8ff37461cde0",
  "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json": "250b84ae0638d98115d748a32ae2f2c9357942b0",
  "package-lock.json": "2ad31f01195434617ac74d2f377287a15e062b95",
  ".woodpecker/formal-static.yaml": "c7355c240d8e6d655322894389eb38f02cd6d532"
};

const sha256 = value => createHash("sha256").update(value).digest("hex");
const gitBlob = value => createHash("sha1")
  .update(Buffer.from("blob " + value.length + "\0"))
  .update(value)
  .digest("hex");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  return {
    argv: [command, ...args],
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function runAsNonRoot(command, args, options = {}) {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (uid === 0) {
    return {
      ...run("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", command, ...args], options),
      execution_uid: 65534
    };
  }
  assert.ok(uid > 0, "cannot establish a non-root execution identity");
  return { ...run(command, args, options), execution_uid: uid };
}

function assertCommand(name) {
  const result = run("bash", ["-lc", "command -v " + name]);
  assert.equal(result.exit_code, 0, "missing required host command: " + name);
  return result.stdout.trim();
}

function parseReceipt(tsv) {
  const rows = tsv.trimEnd().split(/\r?\n/).map(line => line.split("\t"));
  assert.deepEqual(rows[0], ["runner_schema", "formal-tools/portable-verify/0.2"]);
  assert.deepEqual(rows.at(-1), ["verdict", "PASS"]);
  const cases = rows.slice(1, -1).map(row => ({
    tool: row[0],
    phase: row[1],
    exit_code: Number(row[2]),
    duration_ms: Number(row[3]),
    semantic_pattern_matched: row[4] === "1",
    exit_contract_matched: row[5] === "1",
    label: row[6]
  }));
  assert.deepEqual(cases.map(x => x.phase), ["pos", "neg", "err"]);
  assert.deepEqual(cases.map(x => x.exit_code), [0, 10, 3]);
  assert.ok(cases.every(x => x.semantic_pattern_matched && x.exit_contract_matched));
  return cases;
}

function responseCase(result) {
  assert.equal(result.status, "FIXTURE_TECHNICAL_PASS_UNREVIEWED");
  assert.deepEqual(result.cases.map(x => x.phase), ["pos", "neg", "err"]);
  assert.deepEqual(result.cases.map(x => x.exit_code), [0, 10, 3]);
  return result.cases;
}

async function downloadOriginalArchive(destination) {
  const urls = [
    "https://drive.google.com/uc?export=download&id=" + ARCHIVE_ID,
    "https://drive.usercontent.google.com/download?id=" + ARCHIVE_ID + "&export=download&confirm=t"
  ];
  let lastError = "no URL attempted";
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
      if (!response.ok) {
        lastError = "HTTP " + response.status + " from " + url;
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== ARCHIVE_SIZE || sha256(bytes) !== ARCHIVE_SHA256) {
        lastError = "download identity mismatch: bytes=" + bytes.length + " sha256=" + sha256(bytes);
        continue;
      }
      await writeFile(destination, bytes);
      return { url, bytes: bytes.length, sha256: sha256(bytes) };
    } catch (error) {
      lastError = String(error);
    }
  }
  throw new Error("unable to fetch the exact shared CBMC archive: " + lastError);
}

function safeExtractPython() {
  return [
    "import pathlib, sys, tarfile",
    "src, dst = sys.argv[1], sys.argv[2]",
    "def normalized(base, target):",
    "    parts = []",
    "    for part in list(base.parts) + list(target.parts):",
    "        if part in ('', '.'): continue",
    "        if part == '..':",
    "            if not parts: raise ValueError('link escapes archive root')",
    "            parts.pop()",
    "        else: parts.append(part)",
    "    return pathlib.PurePosixPath(*parts)",
    "with tarfile.open(src, 'r:') as archive:",
    "    members = archive.getmembers()",
    "    if not members: raise ValueError('empty CBMC tar archive')",
    "    seen = set()",
    "    for member in members:",
    "        path = pathlib.PurePosixPath(member.name)",
    "        if path.is_absolute() or '..' in path.parts or path.parts[:2] != ('tools', 'cbmc'):",
    "            raise ValueError('unsafe archive path: ' + member.name)",
    "        if member.name in seen: raise ValueError('duplicate archive path: ' + member.name)",
    "        seen.add(member.name)",
    "        if member.isfile() or member.isdir(): continue",
    "        if member.issym():",
    "            target = pathlib.PurePosixPath(member.linkname)",
    "            if target.is_absolute(): raise ValueError('absolute symlink: ' + member.name)",
    "            resolved = normalized(path.parent, target)",
    "            if resolved.parts[:2] != ('tools', 'cbmc'):",
    "                raise ValueError('escaping symlink: ' + member.name + ' -> ' + member.linkname)",
    "            continue",
    "        raise ValueError('unsupported tar member type: ' + member.name)",
    "    archive.extractall(dst, filter='data')",
    "print('SAFE_EXTRACT_PASS members=' + str(len(members)))"
  ].join("\n");
}

function jsonRpcClient(child) {
  let buffer = "";
  let stdoutRaw = "";
  let stderrRaw = "";
  const messages = [];
  const waiters = [];
  const protocolNoise = [];
  child.stdout.on("data", chunk => {
    const text = chunk.toString("utf8");
    stdoutRaw += text;
    buffer += text;
    for (;;) {
      const at = buffer.indexOf("\n");
      if (at < 0) break;
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { protocolNoise.push(line); continue; }
      const index = waiters.findIndex(waiter => waiter.id === message.id);
      if (index >= 0) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        messages.push(message);
      }
    }
  });
  child.stderr.on("data", chunk => { stderrRaw += chunk.toString("utf8"); });
  function waitFor(id, timeoutMs = 30000) {
    const index = messages.findIndex(message => message.id === id);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolveMessage, rejectMessage) => {
      const waiter = {
        id,
        resolve: resolveMessage,
        reject: rejectMessage,
        timer: setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          rejectMessage(new Error("MCP response timeout id=" + id + " stderr=" + stderrRaw));
        }, timeoutMs)
      };
      waiters.push(waiter);
    });
  }
  function send(message) {
    child.stdin.write(JSON.stringify(message) + "\n");
  }
  return {
    send,
    waitFor,
    get stdoutRaw() { return stdoutRaw; },
    get stderrRaw() { return stderrRaw; },
    get protocolNoise() { return protocolNoise; }
  };
}

const targetRuntime = process.platform === "linux" &&
  process.arch === "x64" &&
  process.versions.node === "24.21.0";

test("CBMC current-main Runner/CLI/SDK/MCP T4 end-to-end", {
  skip: targetRuntime ? false : "requires the configured Woodpecker Debian 13 x86_64 Node 24.21.0 agent",
  timeout: 600000
}, async t => {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.versions.node, "24.21.0");

  const runtime = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    host_uid: typeof process.getuid === "function" ? process.getuid() : null
  };
  for (const name of ["zstd", "python3", "setpriv", "timeout", "ldd", "bash"]) assertCommand(name);
  const lock = JSON.parse(await readFile(join(ROOT, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/server"].version, "2.4.0");
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/core"].version, "2.4.0");
  assert.equal(lock.packages["node_modules/zod"].version, "4.6.7");

  const sourcePins = {};
  for (const [path, expected] of Object.entries(SOURCE_BLOBS)) {
    const bytes = await readFile(join(ROOT, path));
    const actual = gitBlob(bytes);
    assert.equal(actual, expected, "current-main source pin drift: " + path);
    sourcePins[path] = actual;
  }

  const work = await mkdtemp(join(tmpdir(), "cbmc-current-main-t4-"));
  await chmod(work, 0o755);
  const root = join(work, "portable");
  const evidenceDir = join(root, "evidence");
  const archivePath = join(work, "cbmc-6.11.0-linux-x86_64.tar.zst");
  const tarPath = join(work, "cbmc-6.11.0-linux-x86_64.tar");
  const runnerPath = join(root, "bin", "tool-runner");
  const metaPath = join(root, "tools", "cbmc", "meta.json");
  const metaShPath = join(root, "tools", "cbmc", "meta.sh");
  const fixturePath = join(root, "tests", "cbmc", "expect.sh");
  const summary = {
    output_label: "FORMAL_TOOLS_I24_CBMC_CURRENT_MAIN_T4_READY",
    current_main: CURRENT_MAIN,
    runtime,
    source_pins: sourcePins,
    package: {},
    direct_runner: {},
    cli: {},
    sdk: {},
    mcp: {},
    qualification: {
      T4: "PENDING_INDEPENDENT_REVIEW",
      T1: "NOT_QUALIFIED",
      T5: "NOT_QUALIFIED",
      T6: "NOT_QUALIFIED",
      Product: "NOT_GRANTED",
      Release: "NOT_GRANTED"
    }
  };

  try {
    const downloaded = await downloadOriginalArchive(archivePath);
    summary.package.archive = downloaded;
    summary.package.upstream_deb = UPSTREAM_DEB;
    const builderSource = await readFile(join(ROOT, "portable/builders/tools/cbmc.sh"), "utf8");
    assert.match(builderSource, /523196902/);
    assert.match(builderSource, /ubuntu-24\\.04-cbmc-6\\.11\\.0-Linux\\.deb/);
    assert.match(builderSource, /b3721aa541038384d7801ea3aeabbcddc3e8845ac8f1cbff637cf8dec7481ac8/);
    const compressed = run("zstd", ["-t", archivePath]);
    assert.equal(compressed.exit_code, 0, compressed.stderr);

    const decompressed = spawnSync("zstd", ["-d", "-c", archivePath], {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 256 * 1024 * 1024
    });
    assert.equal(decompressed.status, 0, String(decompressed.stderr ?? ""));
    await writeFile(tarPath, decompressed.stdout);
    const extraction = run("python3", ["-c", safeExtractPython(), tarPath, root]);
    assert.equal(extraction.exit_code, 0, extraction.stdout + extraction.stderr);
    summary.package.safe_extract = extraction.stdout.trim();

    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "tests", "cbmc"), { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    await copyFile(join(ROOT, "portable/packaging/bundle-template/bin/tool-runner"), runnerPath);
    for (const name of ["expect.sh", "pos.c", "neg.c", "err.c"]) {
      await copyFile(join(ROOT, "portable/verification/cases/cbmc", name), join(root, "tests", "cbmc", name));
    }
    await chmod(runnerPath, 0o755);
    await chmod(root, 0o755);
    await chmod(evidenceDir, 0o777);

    const originalMetaSh = await readFile(metaShPath, "utf8");
    const originalMeta = JSON.parse(await readFile(metaPath, "utf8"));
    assert.equal(originalMeta.tool_id, "cbmc");
    assert.equal(originalMeta.version, "6.11.0");
    assert.equal(originalMeta.upstream_url, "https://github.com/diffblue/cbmc/releases/download/cbmc-6.11.0/ubuntu-24.04-cbmc-6.11.0-Linux.deb");
    assert.equal(originalMeta.unavailable, false);
    assert.match(originalMetaSh, /^TOOL_TOOL_ID=cbmc$/m);
    assert.doesNotMatch(originalMetaSh, /^TOOL_ID=/m);
    summary.package.original_meta = {
      meta_sh_sha256: sha256(await readFile(metaShPath)),
      meta_json_sha256: sha256(await readFile(metaPath)),
      metadata_contract: "TOOL_TOOL_ID legacy key; current Runner requires TOOL_ID"
    };
    assert.equal(summary.package.original_meta.meta_sh_sha256, ORIGINAL_META_SH_SHA256);
    assert.equal(summary.package.original_meta.meta_json_sha256, META_JSON_SHA256);

    const originalEnv = { ...process.env, FT_EVIDENCE_DIR: evidenceDir };
    const originalDoctor = runAsNonRoot(runnerPath, ["doctor", "cbmc"], { cwd: ROOT, env: originalEnv });
    assert.equal(originalDoctor.exit_code, 2);
    assert.match(originalDoctor.stdout + originalDoctor.stderr, /invalid tool metadata/);
    summary.package.original_meta_fail_closed = {
      argv: originalDoctor.argv,
      uid: originalDoctor.execution_uid,
      exit_code: originalDoctor.exit_code,
      stdout: originalDoctor.stdout,
      stderr: originalDoctor.stderr
    };

    const metaEnv = {
      ...process.env,
      M_TOOL_ID: originalMeta.tool_id,
      M_TOOL_VERSION: originalMeta.version,
      M_TOOL_KIND: originalMeta.kind,
      M_MAIN_BIN: originalMeta.main_bin ?? "",
      M_GLIBC_MAX: originalMeta.glibc_max ?? "",
      M_ELF_ARCH: originalMeta.elf_arch ?? "",
      M_NEEDED: originalMeta.needed_libs ?? "",
      M_VERSION_OUTPUT: originalMeta.version_output ?? "",
      M_UPSTREAM_URL: originalMeta.upstream_url ?? "",
      M_UPSTREAM_NOTE: originalMeta.upstream_note ?? "",
      M_BUILD_TS: originalMeta.build_ts,
      M_UNAVAILABLE: originalMeta.unavailable ? "1" : "0",
      M_REASON: originalMeta.unavailable_reason ?? ""
    };
    const regenerate = run("python3", [join(ROOT, "portable/builders/make_meta.py"), join(root, "tools", "cbmc")], {
      cwd: ROOT,
      env: metaEnv
    });
    assert.equal(regenerate.exit_code, 0, regenerate.stdout + regenerate.stderr);
    const generatedMetaSh = await readFile(metaShPath, "utf8");
    assert.match(generatedMetaSh, /^TOOL_ID=cbmc$/m);
    assert.doesNotMatch(generatedMetaSh, /^TOOL_TOOL_ID=/m);
    summary.package.current_main_metadata_regeneration = {
      make_meta_blob: SOURCE_BLOBS["portable/builders/make_meta.py"],
      meta_sh_sha256: sha256(await readFile(metaShPath)),
      meta_json_sha256: sha256(await readFile(metaPath)),
      stdout: regenerate.stdout,
      stderr: regenerate.stderr
    };
    assert.equal(summary.package.current_main_metadata_regeneration.meta_sh_sha256, GENERATED_META_SH_SHA256);
    assert.equal(summary.package.current_main_metadata_regeneration.meta_json_sha256, META_JSON_SHA256);

    await chmod(root, 0o755);
    await chmod(join(root, "tools"), 0o755);
    await chmod(join(root, "tools", "cbmc"), 0o755);
    await chmod(join(root, "tools", "cbmc", "run"), 0o755);
    await chmod(runnerPath, 0o755);
    await chmod(evidenceDir, 0o777);

    const runnerBytes = await readFile(runnerPath);
    const metaBytes = await readFile(metaPath);
    const fixtureBytes = await readFile(fixturePath);
    assert.equal(sha256(runnerBytes), RUNNER_SHA256);
    assert.equal(sha256(metaBytes), META_JSON_SHA256);
    assert.equal(sha256(fixtureBytes), FIXTURE_SHA256);
    summary.package.normalized_candidate = {
      runner_sha256: sha256(runnerBytes),
      meta_sh_sha256: sha256(await readFile(metaShPath)),
      meta_json_sha256: sha256(metaBytes),
      fixture_contract_sha256: sha256(fixtureBytes),
      candidate_scope: "original binary archive + current-main make_meta.py regenerated metadata; not byte-identical to original archive"
    };

    const directEnv = { ...process.env, FT_EVIDENCE_DIR: evidenceDir };
    const directDoctor = runAsNonRoot(runnerPath, ["doctor", "cbmc"], { cwd: ROOT, env: directEnv });
    assert.equal(directDoctor.exit_code, 0, directDoctor.stdout + directDoctor.stderr);
    assert.match(directDoctor.stdout, /verdict: OK/);
    const directVersion = runAsNonRoot(runnerPath, ["version", "cbmc"], { cwd: ROOT, env: directEnv });
    assert.equal(directVersion.exit_code, 0, directVersion.stdout + directVersion.stderr);
    assert.match(directVersion.stdout, /version: 6\.11\.0/);
    const binaryVersion = runAsNonRoot(runnerPath, ["run", "cbmc", "--version"], { cwd: ROOT, env: directEnv });
    assert.equal(binaryVersion.exit_code, 0, binaryVersion.stdout + binaryVersion.stderr);
    assert.match(binaryVersion.stdout, /CBMC version 6\.11\.0/);
    const directVerify = runAsNonRoot(runnerPath, ["verify", "cbmc"], { cwd: ROOT, env: directEnv });
    assert.equal(directVerify.exit_code, 0, directVerify.stdout + directVerify.stderr);
    const tsv = await readFile(join(evidenceDir, "verify-cbmc.tsv"), "utf8");
    const directCases = parseReceipt(tsv);
    const directLogs = {};
    for (const phase of ["pos", "neg", "err"]) {
      const bytes = await readFile(join(evidenceDir, "verify-cbmc." + phase + ".log"));
      directLogs[phase] = { sha256: sha256(bytes), text: bytes.toString("utf8") };
    }
    summary.direct_runner = {
      doctor: { ...directDoctor, stdout_sha256: sha256(directDoctor.stdout), stderr_sha256: sha256(directDoctor.stderr) },
      version: { ...directVersion, stdout_sha256: sha256(directVersion.stdout), stderr_sha256: sha256(directVersion.stderr) },
      binary_version: { ...binaryVersion, stdout_sha256: sha256(binaryVersion.stdout), stderr_sha256: sha256(binaryVersion.stderr) },
      verify: { ...directVerify, stdout_sha256: sha256(directVerify.stdout), stderr_sha256: sha256(directVerify.stderr) },
      receipt_tsv: { text: tsv, sha256: sha256(tsv), cases: directCases },
      logs: directLogs
    };

    const gatewayEnv = {
      ...process.env,
      FORMAL_PORTABLE_ROOT: root,
      FORMAL_PORTABLE_RUNNER_SHA256: RUNNER_SHA256,
      FORMAL_PORTABLE_META_SHA256: META_JSON_SHA256,
      FORMAL_PORTABLE_FIXTURE_SHA256: FIXTURE_SHA256
    };
    const cliPath = join(ROOT, "packages/runner/js/cli.mjs");
    const cliDoctor = runAsNonRoot(process.execPath, [cliPath, "portfolio", "doctor", "cbmc"], { cwd: ROOT, env: gatewayEnv });
    assert.equal(cliDoctor.exit_code, 0, cliDoctor.stdout + cliDoctor.stderr);
    const cliDoctorResult = JSON.parse(cliDoctor.stdout);
    assert.equal(cliDoctorResult.status, "DOCTOR_EXECUTED_NOT_T3");
    const cliVerify = runAsNonRoot(process.execPath, [cliPath, "portfolio", "verify", "cbmc"], { cwd: ROOT, env: gatewayEnv });
    assert.equal(cliVerify.exit_code, 0, cliVerify.stdout + cliVerify.stderr);
    const cliVerifyResult = JSON.parse(cliVerify.stdout);
    const cliCases = responseCase(cliVerifyResult);
    const cliMalformed = runAsNonRoot(process.execPath, [cliPath, "portfolio", "verify", "cbmc", "extra"], { cwd: ROOT, env: gatewayEnv });
    assert.equal(cliMalformed.exit_code, 2);
    assert.match(cliMalformed.stderr, /portfolio usage/);
    summary.cli = {
      doctor: { argv: cliDoctor.argv, uid: cliDoctor.execution_uid, exit_code: cliDoctor.exit_code, stdout: cliDoctor.stdout, stderr: cliDoctor.stderr, stdout_sha256: sha256(cliDoctor.stdout), stderr_sha256: sha256(cliDoctor.stderr) },
      verify: { argv: cliVerify.argv, uid: cliVerify.execution_uid, exit_code: cliVerify.exit_code, stdout: cliVerify.stdout, stderr: cliVerify.stderr, stdout_sha256: sha256(cliVerify.stdout), stderr_sha256: sha256(cliVerify.stderr), cases: cliCases },
      malformed: { argv: cliMalformed.argv, uid: cliMalformed.execution_uid, exit_code: cliMalformed.exit_code, stdout: cliMalformed.stdout, stderr: cliMalformed.stderr }
    };

    const sdkUrl = pathToFileURL(join(ROOT, "packages/runner/js/sdk.mjs")).href;
    const sdkScript = [
      "import { inspectPortfolioTool, planPortfolioFixture, runPortableGate } from " + JSON.stringify(sdkUrl) + ";",
      "const result = {};",
      "result.inspect = await inspectPortfolioTool('cbmc');",
      "result.plan = planPortfolioFixture('cbmc');",
      "result.doctor = await runPortableGate('cbmc', { mode: 'doctor' });",
      "result.verify = await runPortableGate('cbmc', { mode: 'verify-fixture' });",
      "try { await runPortableGate('cbmc', { mode: 'raw' }); result.invalid_mode = 'ACCEPTED'; } catch (e) { result.invalid_mode = String(e); }",
      "try { await runPortableGate('not-a-candidate'); result.invalid_tool = 'ACCEPTED'; } catch (e) { result.invalid_tool = String(e); }",
      "process.stdout.write(JSON.stringify(result));"
    ].join("\n");
    const sdkScriptPath = join(work, "sdk-probe.mjs");
    await writeFile(sdkScriptPath, sdkScript);
    const sdkRun = runAsNonRoot(process.execPath, [sdkScriptPath], { cwd: ROOT, env: gatewayEnv });
    assert.equal(sdkRun.exit_code, 0, sdkRun.stdout + sdkRun.stderr);
    const sdkResult = JSON.parse(sdkRun.stdout);
    assert.equal(sdkResult.inspect.status, "FOUND_PINNED_NOT_EXECUTED");
    assert.equal(sdkResult.doctor.status, "DOCTOR_EXECUTED_NOT_T3");
    const sdkCases = responseCase(sdkResult.verify);
    assert.match(sdkResult.invalid_mode, /unadmitted portable operation/);
    assert.match(sdkResult.invalid_tool, /unknown portfolio tool/);
    summary.sdk = {
      argv: sdkRun.argv,
      uid: sdkRun.execution_uid,
      exit_code: sdkRun.exit_code,
      stdout: sdkRun.stdout,
      stderr: sdkRun.stderr,
      stdout_sha256: sha256(sdkRun.stdout),
      stderr_sha256: sha256(sdkRun.stderr),
      inspect: sdkResult.inspect,
      plan: sdkResult.plan,
      doctor: sdkResult.doctor,
      verify: { ...sdkResult.verify, cases: sdkCases },
      malformed: { invalid_mode: sdkResult.invalid_mode, invalid_tool: sdkResult.invalid_tool }
    };

    const mcpPackage = {
      server: lock.packages["node_modules/@modelcontextprotocol/server"].version,
      core: lock.packages["node_modules/@modelcontextprotocol/core"].version,
      zod: lock.packages["node_modules/zod"].version
    };
    const mcpChild = process.getuid && process.getuid() === 0
      ? spawn("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", process.execPath, join(ROOT, "packages/runner/js/mcp.mjs")], {
          cwd: ROOT, env: gatewayEnv, stdio: ["pipe", "pipe", "pipe"]
        })
      : spawn(process.execPath, [join(ROOT, "packages/runner/js/mcp.mjs")], {
          cwd: ROOT, env: gatewayEnv, stdio: ["pipe", "pipe", "pipe"]
        });
    const rpc = jsonRpcClient(mcpChild);
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cbmc-current-main-t4", version: "1.0.0" }
      }
    };
    rpc.send(initRequest);
    const initialized = await rpc.waitFor(1);
    assert.ok(initialized.result?.serverInfo?.name === "formal-tools-skill" || initialized.result?.serverInfo?.name);
    rpc.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    rpc.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await rpc.waitFor(2);
    const toolNames = (listed.result?.tools ?? []).map(tool => tool.name);
    assert.ok(toolNames.includes("verify_portable_fixture"));
    assert.ok(!toolNames.includes("native"));
    rpc.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "verify_portable_fixture", arguments: { tool: "cbmc", timeout_s: 120 } }
    });
    const called = await rpc.waitFor(3);
    assert.equal(called.result?.isError ?? false, false, JSON.stringify(called));
    const mcpReceipt = JSON.parse(called.result.content[0].text);
    const mcpCases = responseCase(mcpReceipt);
    rpc.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "verify_portable_fixture", arguments: { tool: "not-a-candidate", timeout_s: 120 } }
    });
    const malformedMcp = await rpc.waitFor(4);
    assert.ok(malformedMcp.error || malformedMcp.result?.isError === true, JSON.stringify(malformedMcp));
    assert.deepEqual(rpc.protocolNoise, [], "MCP stdout must contain only JSON-RPC protocol messages");
    mcpChild.kill("SIGTERM");
    await new Promise(resolveClose => {
      if (mcpChild.exitCode !== null || mcpChild.signalCode !== null) return resolveClose();
      mcpChild.once("close", resolveClose);
    });
    summary.mcp = {
      dependencies: mcpPackage,
      server_process: "Node 24.21.0 via stdio, unprivileged",
      initialize: initialized,
      tools: toolNames,
      verify: { response: called, receipt: mcpReceipt, cases: mcpCases },
      malformed: malformedMcp,
      stdout_sha256: sha256(rpc.stdoutRaw),
      stderr: rpc.stderrRaw,
      stderr_sha256: sha256(rpc.stderrRaw),
      protocol_noise: rpc.protocolNoise,
      server_exit_code: mcpChild.exitCode,
      server_signal: mcpChild.signalCode
    };

    summary.qualification.T4 = "TECHNICAL_E2E_PASS_UNREVIEWED";
    summary.evidence_sha256 = sha256(JSON.stringify(summary));
    t.diagnostic("CBMC_CURRENT_MAIN_T4_EVIDENCE=" + JSON.stringify(summary));
    assert.equal(summary.qualification.T4, "TECHNICAL_E2E_PASS_UNREVIEWED");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
