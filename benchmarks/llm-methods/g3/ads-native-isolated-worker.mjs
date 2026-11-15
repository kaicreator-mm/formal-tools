import { parentPort, workerData } from "node:worker_threads";
import { executeAds24 } from "./ads-native-replay.mjs";

if (!parentPort) throw new Error("ADS24 worker requires a parent port");

try {
  const result = await executeAds24(workerData.args);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || ""
    }
  });
}
