import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

/**
 * Concurrency-safe entry point for the historical, receipt-pinned ADS24
 * orchestrator. That frozen source temporarily writes process.env, so it must
 * execute in a Worker with a private environment copy rather than concurrently
 * in the caller's thread. The frozen source itself remains byte-identical.
 */
export function executeAds24Isolated(args) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new TypeError("invalid ADS24 arguments");
  if (typeof args.binary_dir !== "string" || !args.binary_dir.trim())
    throw new TypeError("binary_dir must be a non-empty path");

  const binaryDir = resolve(args.binary_dir);
  const worker = new Worker(
    new URL("./ads-native-isolated-worker.mjs", import.meta.url),
    {
      workerData: { args: { ...args, binary_dir: binaryDir } },
      env: { ...process.env, FORMAL_TOOLS_BIN_DIR: binaryDir }
    }
  );

  return new Promise((resolveResult, rejectResult) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    };
    worker.once("message", message => {
      if (settled) return;
      settled = true;
      if (message?.ok === true) {
        resolveResult(message.result);
        return;
      }
      const error = new Error(message?.error?.message || "ADS24 worker failed");
      error.name = message?.error?.name || "Error";
      if (message?.error?.stack) error.stack = message.error.stack;
      rejectResult(error);
    });
    worker.once("error", fail);
    worker.once("exit", code => {
      if (!settled)
        fail(new Error("ADS24 worker exited without a result (exit " + code + ")"));
    });
  });
}
