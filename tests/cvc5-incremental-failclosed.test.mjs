/**
 * cvc5 typed solve intentionally has a single-query CLI contract.
 *
 * R94 observed an original multi-query SMT-LIB push/pop invocation fail when
 * --incremental was absent. These are deterministic source/mocked-process
 * regressions, NOT a native cvc5 invocation or semantic solver attestation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planNative } from "../packages/runner/js/native-catalog.mjs";
import {
  executeNativePlan,
  interpret,
  interpretNativeObservation
} from "../packages/runner/js/native.mjs";

const observation = (stdout, exit_code, stderr = "") => ({
  stdout, stderr, exit_code,
  timed_out: false, error: null, output_truncated: false
});

test("cvc5 typed solve never silently enables incremental queries", () => {
  const plan = planNative("cvc5", "solve", { input: "single.smt2" });
  assert.equal(plan.tool, "cvc5");
  assert.equal(plan.mode, "typed");
  assert.equal(plan.entry, "cvc5");
  assert.deepEqual(plan.args, ["--lang", "smt2", "single.smt2"]);
  assert.equal(plan.args.includes("--incremental"), false);
  assert.throws(
    () => planNative("cvc5", "solve", { input: "multi.smt2", incremental: true }),
    /incremental|unknown|option|invalid|unsupported/i
  );
});

test("nonzero cvc5 process with lexical SAT or UNSAT cannot PASS a fixture", () => {
  const diagnostic = "Cannot make multiple queries unless incremental solving is enabled (try --incremental)\n";
  for (const [which, token] of [["negative", "sat"], ["positive", "unsat"]]) {
    const steps = [observation(token + "\n", 1, diagnostic)];
    const interpreted = interpret("cvc5", which, steps);
    // Text extraction is not a process verdict and does not override exit=1.
    assert.equal(interpreted.tool_outcome, token.toUpperCase());
    assert.equal(interpreted.test_verdict, "INCONCLUSIVE");
    const native = interpretNativeObservation("cvc5", steps[0].stdout, diagnostic, 1);
    assert.equal(native.process_outcome, "NONZERO_EXIT");
    assert.equal(native.test_verdict, "NOT_EVALUATED");
    assert.equal(native.claim_verdict, "NOT_EVALUATED");
  }
});

test("UNKNOWN, malformed output and truncated execution cannot be upgraded", () => {
  assert.equal(
    interpret("cvc5", "negative", [observation("unknown\n", 0)]).test_verdict,
    "INCONCLUSIVE"
  );
  assert.equal(
    interpret("cvc5", "positive", [observation("error: unsupported option\n", 1)]).test_verdict,
    "INCONCLUSIVE"
  );
  assert.equal(
    interpret("cvc5", "negative", [{
      ...observation("sat\n", 0), output_truncated: true
    }]).test_verdict,
    "INCONCLUSIVE"
  );
  assert.equal(
    interpretNativeObservation("cvc5", "", "parse error", null).process_outcome,
    "NOT_STARTED"
  );
});

test("synthetic cvc5 invocation error propagates nonzero exit end-to-end", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX mock launcher only; does not stand in for native cvc5");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "i24-cvc5-error-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const exe = join(dir, "cvc5");
  await writeFile(exe, [
    "#!/bin/sh",
    "printf 'sat\\n'",
    "printf 'Cannot make multiple queries unless incremental solving is enabled (try --incremental)\\n' >&2",
    "exit 1",
    ""
  ].join("\n"));
  await chmod(exe, 0o700);
  const plan = planNative("cvc5", "solve", { input: "multi.smt2" });
  const result = await executeNativePlan(plan, {
    cwd: dir,
    env: { ...process.env, FORMAL_TOOLS_BIN_DIR: dir },
    timeout: 5
  });
  assert.equal(result.run_status, "EXECUTED");
  assert.equal(result.process_outcome, "NONZERO_EXIT");
  assert.equal(result.test_verdict, "NOT_EVALUATED");
  assert.equal(result.claim_verdict, "NOT_EVALUATED");
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0].exit_code, 1);
  assert.equal(result.executions[0].error, null);
  assert.equal(result.executions[0].stdout, "sat\n");
  assert.match(result.executions[0].stderr, /multiple queries.*incremental/i);
  assert.ok(result.executions[0].argv[0].endsWith("/cvc5"));
  // The lexical SAT token is retained only as an observation, never a PASS.
  assert.equal(result.tool_outcome, "SAT");
});
