/**
 * Shared helpers for the i180 R2 E2E acceptance drivers (branch i180/r2-e2e).
 * OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 * These drivers are EVIDENCE TOOLING committed under evidence/r2/drivers/ so
 * every artifact in evidence/r2/ is reproducible. They run on the trusted
 * Debian host (cc@192.168.100.200) with the pinned portable bundle:
 *   FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=<runner sha> \
 *     $B/bin/tool-runner node validation/mvp-user-e2e/evidence/r2/drivers/<driver>.mjs ...
 * DEEPSEEK_API_KEY comes from the environment only (0600 .dsenv, sourced per
 * run) and is never logged, echoed or persisted by any driver.
 *
 * Honesty contract: every driver records OBSERVED outcomes verbatim; a failed
 * expectation is a recorded finding (exit 2), never a retry-to-green.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DRIVERS_DIR = dirname(fileURLToPath(import.meta.url));
/** evidence/r2 */
export const R2_ROOT = resolve(DRIVERS_DIR, "..");
/** validation/mvp-user-e2e/evidence */
export const EVIDENCE_ROOT = resolve(R2_ROOT, "..");
/** repo root (validation/mvp-user-e2e/evidence -> mvp-user-e2e -> validation -> root) */
export const REPO_ROOT = resolve(EVIDENCE_ROOT, "..", "..", "..");

export const sha256HexText = (text) => createHash("sha256").update(text, "utf8").digest("hex");
export const sha256HexBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

export function requireSourceSha() {
  const sha = arg("--source-sha", null);
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
    process.stderr.write(JSON.stringify({ driver_error: "--source-sha <40hex git SHA> is required" }) + "\n");
    process.exit(5);
  }
  return sha;
}

export async function saveJson(outDir, name, obj) {
  await mkdir(outDir, { recursive: true });
  const p = join(outDir, name);
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return p;
}

export async function logTo(outDir, logName, line) {
  await mkdir(outDir, { recursive: true });
  await appendFile(join(outDir, logName), "[" + new Date().toISOString() + "] " + line + "\n", "utf8");
}

export const hasDeepSeekKey = () =>
  typeof process.env.DEEPSEEK_API_KEY === "string" && process.env.DEEPSEEK_API_KEY.length > 0;

/** Redaction guard used on every transcript before it is persisted. */
export function assertNoKeyMaterial(obj) {
  const text = JSON.stringify(obj);
  if (/sk-[A-Za-z0-9]{20,}/.test(text)) throw new Error("key-shaped material detected; refusing to persist");
  const envKey = process.env.DEEPSEEK_API_KEY;
  if (envKey && text.includes(envKey)) throw new Error("env key value detected; refusing to persist");
  return obj;
}

/**
 * Minimal newline-delimited JSON-RPC MCP stdio client. Unlike the V6
 * run-mcp.mjs client (which strips FORMAL_PORTABLE_* from the child env for
 * planning-only probes), this client KEEPS the parent environment so
 * execute_workflow can reach the pinned bundle. Spawned with the same node
 * that runs the driver (the bundled node on the host).
 */
export async function startMcpExecuteClient({ timeoutMs = 120000 } = {}) {
  const { spawn } = await import("node:child_process");
  const MCP_SERVER_PATH = join(REPO_ROOT, "packages", "runner", "js", "mcp.mjs");
  const child = spawn(process.execPath, [MCP_SERVER_PATH],
    { stdio: ["pipe", "pipe", "pipe"], env: process.env, cwd: REPO_ROOT });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const transcript = [];
  const stderrTail = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { transcript.push({ unparseable: line.slice(0, 200) }); continue; }
      transcript.push({ inbound: msg });
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { for (const line of c.split("\n")) if (line.trim()) stderrTail.push(line.slice(0, 300)); });

  const request = (method, params, reqTimeoutMs = timeoutMs) => {
    const id = nextId++;
    transcript.push({ outbound: { id, method } });
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout waiting for ${method} (id=${id})`)), reqTimeoutMs);
      pending.set(id, (msg) => { clearTimeout(timer); ok(msg); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };
  const call = async (name, args_, reqTimeoutMs = timeoutMs) => {
    const resp = await request("tools/call", { name, arguments: args_ }, reqTimeoutMs);
    let parsed;
    const block = resp.result?.content?.find((b) => b.type === "text");
    if (block) { try { parsed = JSON.parse(block.text); } catch { parsed = block.text; } }
    return { resp, parsed: parsed ?? null, isError: resp.result?.isError === true, rpcError: resp.error?.message ?? null };
  };
  const close = async () => {
    try { child.stdin.end(); } catch { /* already closing */ }
    child.kill();
    await new Promise((ok) => { const t = setTimeout(ok, 1000); child.once("exit", () => { clearTimeout(t); ok(); }); });
  };
  return { child, request, call, close, transcript, stderrTail };
}

export const check = (list, name, pass, detail = "") => {
  list.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}\n`);
  return Boolean(pass);
};
