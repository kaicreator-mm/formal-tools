#!/usr/bin/env node
/**
 * Standalone read-only capabilities CLI for the r176 capability-validation lane.
 *
 * Lives outside packages/runner/js/cli.mjs because that file's git blob is
 * pinned by docs/tool-portfolio/r99/CBMC_CURRENT_MAIN_T4.json source evidence;
 * a subcommand there would invalidate pinned cross-lane receipts. This entry
 * point exposes the same surface intended for cli.mjs once the pin-owning lane
 * reconciles its evidence. It never launches tools and never executes native
 * processes: summary/match/tool are pure registry reads over the frozen G1
 * discovery index plus the sha256-bound probe receipts.
 *
 * Usage:
 *   node packages/runner/js/capabilities-cli.mjs summary
 *   node packages/runner/js/capabilities-cli.mjs match --cap <id> [--cap <id> ...] [--include-not-verified]
 *   node packages/runner/js/capabilities-cli.mjs tool <id>
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadCapabilityValidation, matchValidatedTools } from "./capability-validation.mjs";
import { listProblemCapabilities } from "./problem-capabilities.mjs";

const print = (x) => process.stdout.write(JSON.stringify(x, null, 2) + "\n");

export async function main(args = process.argv.slice(2)) {
  try {
    const [sub, arg, ...rest] = args;
    let result;
    if (!sub || sub === "summary") {
      if (sub === "summary" && (arg || rest.length)) throw new TypeError("summary takes no options");
      const ledger = loadCapabilityValidation();
      result = {
        status: ledger.status,
        counts: ledger.counts,
        scope_rules: ledger.scope_rules,
        capabilities: listProblemCapabilities(),
        usage: "summary | match --cap <id> [--cap <id> ...] [--include-not-verified] | tool <id>",
      };
    } else if (sub === "match") {
      /** @type {string[]} */
      const caps = [];
      let includeNotVerified = false;
      const tokens = [arg, ...rest].filter((v) => v !== undefined);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === "--cap") {
          const value = tokens[i + 1];
          if (typeof value !== "string" || !value.length || value.startsWith("--"))
            throw new TypeError("--cap requires a capability id");
          caps.push(value);
          i++;
        } else if (tokens[i] === "--include-not-verified") {
          includeNotVerified = true;
        } else throw new TypeError("match accepts only --cap <id> and --include-not-verified");
      }
      if (!caps.length) throw new TypeError("match requires at least one --cap <id>");
      result = matchValidatedTools(caps, { includeNotVerified });
    } else if (sub === "tool") {
      if (!arg || rest.length) throw new TypeError("tool requires exactly one tool id");
      const ledger = loadCapabilityValidation();
      const row = ledger.tools.find((t) => t.id === arg);
      if (!row) throw new RangeError("unknown tool id: " + arg);
      result = row;
    } else {
      throw new TypeError("usage: capabilities-cli.mjs <summary|match --cap ID [...] | tool ID>");
    }
    print(result);
    return 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: "ERROR", message: String(error) }) + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main();
