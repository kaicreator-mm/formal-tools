#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: real-provider planning probe (issue #186).
 *
 * Reads DEEPSEEK_API_KEY from the environment (never hardcoded, never printed,
 * never written to the transcript), calls https://api.deepseek.com/chat/completions
 * (model deepseek-chat) with fixtures/user-prompt-a.txt plus a system instruction to
 * propose a Method DAG in JSON, prints the raw proposal and whether it maps onto the
 * pinned plan allowlist (tools z3|cvc5|highs|compare; operations solve-smt|solve-lp|
 * cross-check).
 *
 * THIS IS A CONNECTIVITY/SHAPE PROBE, explicitly NOT the final E2E. The transcript
 * saved under evidence/deepseek-probe/ is the real API response, labeled
 * kind=PROBE_NOT_FINAL_E2E, with the Authorization header redacted by construction.
 *
 * Exit codes: 0 = response received (mapping verdict inside the report),
 * 3 = BLOCKED_PROVIDER (no API key in env), 4 = provider HTTP/network failure,
 * 5 = harness error.
 */
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { REPO_ROOT, PLAN_TOOL_ALLOWLIST, PLAN_OPERATION_ALLOWLIST } from "./lib.mjs";

const ENDPOINT = new URL("https://api.deepseek.com/chat/completions");
const MODEL = "deepseek-chat";
export const DEFAULT_OUT_DIR = "validation/mvp-user-e2e/evidence/deepseek-probe";

const SYSTEM_INSTRUCTION = `You are a planning assistant for a formal-methods tool harness.
Propose a Method DAG for the user's request as a single JSON object, no prose outside JSON:
{"method_dag":[{"id":"s1","tool":"z3|cvc5|highs|compare","operation":"solve-smt|solve-lp|cross-check","depends_on":[],"note":"..."}]}
Hard constraints:
- tools must come ONLY from: ${PLAN_TOOL_ALLOWLIST.join(", ")}
- operations must come ONLY from: ${PLAN_OPERATION_ALLOWLIST.join(", ")}
- keep the DAG minimal (typically: one solve per solver, then a compare cross-check)
If the request cannot be mapped onto these tools, reply with {"method_dag":[],"unmappable":true}.`;

/** Minimal CONNECT tunnel for an HTTP proxy (fallback path only). */
function connectThroughProxy(proxy, targetPort, timeoutMs) {
  return new Promise((ok, fail) => {
    const req = httpRequest({
      host: proxy.hostname, port: Number(proxy.port || 80), method: "CONNECT",
      path: `${ENDPOINT.hostname}:${targetPort}`,
      headers: { host: `${ENDPOINT.hostname}:${targetPort}` }
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("proxy CONNECT timeout")));
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); fail(new Error("proxy CONNECT failed: " + res.statusCode)); return; }
      ok(socket);
    });
    req.on("error", fail);
    req.end();
  });
}

function readHttpsResponse(tlsSocket) {
  return new Promise((ok, fail) => {
    const chunks = [];
    tlsSocket.on("data", (c) => chunks.push(c));
    tlsSocket.on("error", fail);
    tlsSocket.on("close", () => {
      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf("\r\n\r\n");
      if (sep < 0) { fail(new Error("no HTTP header terminator from provider")); return; }
      const head = raw.subarray(0, sep).toString("utf8");
      let body = raw.subarray(sep + 4);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        const decoded = [];
        let off = 0;
        while (off < body.length) {
          const lineEnd = body.indexOf("\r\n", off);
          if (lineEnd < 0) break;
          const size = parseInt(body.subarray(off, lineEnd).toString("utf8").split(";")[0], 16);
          if (!Number.isFinite(size) || size === 0) break;
          decoded.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
          off = lineEnd + 2 + size + 2;
        }
        body = Buffer.concat(decoded);
      }
      ok({ status, body: body.toString("utf8") });
    });
  });
}

async function callDeepseek(apiKey, body, { timeoutMs = 60000 } = {}) {
  const payload = JSON.stringify(body);
  const headers =
    `POST ${ENDPOINT.pathname} HTTP/1.1\r\n` +
    `host: ${ENDPOINT.host}\r\n` +
    `authorization: Bearer ${apiKey}\r\n` +
    `content-type: application/json\r\n` +
    `accept: application/json\r\n` +
    `content-length: ${Buffer.byteLength(payload)}\r\n` +
    `connection: close\r\n\r\n`;
  const attempt = async (viaProxy) => {
    let socket;
    if (viaProxy) {
      const proxy = new URL(process.env.HTTPS_PROXY ?? process.env.https_proxy);
      socket = await connectThroughProxy(proxy, 443, timeoutMs);
    }
    return await awaitTlsHandshakeAndSend(socket, headers, payload, timeoutMs);
  };
  const awaitTlsHandshakeAndSend = (socket, hdrs, pl, timeoutMs) => new Promise((ok, fail) => {
    const tls = tlsConnect(socket ? { socket, servername: ENDPOINT.hostname } : { host: ENDPOINT.hostname, port: 443, servername: ENDPOINT.hostname }, () => {
      tls.setTimeout(timeoutMs, () => tls.destroy(new Error("provider response timeout")));
      tls.write(hdrs + pl);
    });
    tls.on("error", fail);
    readHttpsResponse(tls).then(ok, fail);
  });
  // Try direct first; on network failure retry once through the configured proxy.
  try { return await attempt(false); }
  catch (directErr) {
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    if (!proxyUrl) throw directErr;
    return await attempt(true);
  }
}

/** Extract the first JSON object from an assistant message and check allowlists. */
export function mapProposalToAllowlist(message) {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "NO_JSON_IN_PROPOSAL" };
  let parsed;
  try { parsed = JSON.parse(message.slice(start, end + 1)); }
  catch (e) { return { ok: false, reason: "PROPOSAL_JSON_UNPARSEABLE", detail: String(e).slice(0, 200) }; }
  const dag = Array.isArray(parsed.method_dag) ? parsed.method_dag : [];
  const unknownTools = [], unknownOps = [];
  for (const node of dag) {
    if (!PLAN_TOOL_ALLOWLIST.includes(node.tool)) unknownTools.push(node.tool);
    if (!PLAN_OPERATION_ALLOWLIST.includes(node.operation)) unknownOps.push(node.operation);
  }
  return {
    ok: dag.length > 0 && unknownTools.length === 0 && unknownOps.length === 0,
    dag_node_count: dag.length,
    unmappable_flag: parsed.unmappable === true,
    unknown_tools: [...new Set(unknownTools)],
    unknown_operations: [...new Set(unknownOps)],
    parsed_proposal: parsed
  };
}

export async function runProbe({ outDir = resolve(REPO_ROOT, DEFAULT_OUT_DIR), promptPath = resolve(REPO_ROOT, "validation/mvp-user-e2e/fixtures/user-prompt-a.txt") } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { schema: "formal-tools/deepseek-probe-transcript/1.0", kind: "PROBE_NOT_FINAL_E2E",
      entry: "deepseek-plan", blocked: "BLOCKED_PROVIDER",
      detail: "DEEPSEEK_API_KEY not set in environment; probe skipped, nothing fabricated." };
  }
  const userPrompt = await readFile(promptPath, "utf8");
  const httpBody = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: userPrompt }
    ],
    stream: false,
    temperature: 0,
    max_tokens: 800
  };
  const { status, body } = await callDeepseek(apiKey, httpBody);
  let parsedBody;
  try { parsedBody = JSON.parse(body); } catch { parsedBody = undefined; }
  const message = parsedBody?.choices?.[0]?.message?.content ?? "";
  const mapping = mapProposalToAllowlist(message);
  const transcript = {
    schema: "formal-tools/deepseek-probe-transcript/1.0",
    kind: "PROBE_NOT_FINAL_E2E",
    entry: "deepseek-plan",
    generated_at: new Date().toISOString(),
    provider: "deepseek",
    endpoint: ENDPOINT.href,
    model: MODEL,
    http_status: status,
    request: {
      system_instruction: SYSTEM_INSTRUCTION,
      user_prompt_path: "validation/mvp-user-e2e/fixtures/user-prompt-a.txt",
      user_prompt: userPrompt,
      temperature: 0,
      max_tokens: 800,
      authorization_header: "REDACTED_BY_CONSTRUCTION"
    },
    response: {
      raw_body: body.slice(0, 65536),
      assistant_message: message.slice(0, 16384),
      usage: parsedBody?.usage ?? null
    },
    proposal_mapping: mapping,
    disclaimer: "Connectivity/shape probe only. NOT the final E2E; the plan produced here is not an executed plan."
  };
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
  }
  return transcript;
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx >= 0 ? resolve(process.cwd(), process.argv[outIdx + 1]) : resolve(REPO_ROOT, DEFAULT_OUT_DIR);
  let result;
  try { result = await runProbe({ outDir }); }
  catch (e) {
    process.stderr.write(JSON.stringify({ entry: "deepseek-plan", outcome: "PROVIDER_HTTP_ERROR", detail: String(e).slice(0, 300) }) + "\n");
    return 4;
  }
  if (result.blocked === "BLOCKED_PROVIDER") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 3;
  }
  process.stdout.write(JSON.stringify({
    entry: "deepseek-plan", http_status: result.http_status,
    proposal_mapping: { ok: result.proposal_mapping.ok, dag_node_count: result.proposal_mapping.dag_node_count,
      unknown_tools: result.proposal_mapping.unknown_tools, unknown_operations: result.proposal_mapping.unknown_operations,
      unmappable_flag: result.proposal_mapping.unmappable_flag },
    assistant_message: result.response.assistant_message,
    transcript_saved_to: outDir
  }, null, 2) + "\n");
  return result.http_status === 200 ? 0 : 4;
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
