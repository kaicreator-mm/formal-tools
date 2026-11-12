import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json", import.meta.url);
const dag = JSON.parse(readFileSync(path, "utf8"));

function acyclic(items, name) {
  const nodes = new Map(items.map((x) => [x.id, x]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    assert.ok(nodes.has(id), `${name}: unknown node ${id}`);
    assert.ok(!visiting.has(id), `${name}: cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of nodes.get(id).depends_on) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
}

test("Tool Portfolio: 36 stable, distinct tool links and correct scoped R3 count", () => {
  assert.equal(dag.schema, "formal-tools/tool-portfolio-dag/1.0");
  assert.equal(dag.authority.portfolio_issue, 24);
  assert.equal(dag.authority.product_issue, 11);
  assert.equal(dag.authority.excluded_issue, 7);
  assert.equal(dag.tools.length, 36);
  assert.equal(new Set(dag.tools.map((t) => t.id)).size, 36);
  assert.equal(new Set(dag.tools.map((t) => t.slug)).size, 36);
  assert.equal(new Set(dag.tools.map((t) => t.issue)).size, 36);
  assert.deepEqual(
    dag.tools.map((t) => t.issue),
    Array.from({ length: 36 }, (_, i) => i + 25),
  );
  for (const [i, tool] of dag.tools.entries()) {
    assert.equal(tool.id, `FT-T${String(i + 1).padStart(2, "0")}`);
    assert.equal(tool.package, `${tool.slug}-${tool.version}-linux-x86_64.tar.zst`);
    assert.ok(tool.requires.includes("core"));
    assert.match(tool.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
  assert.equal(dag.tools.filter((t) => t.observed_r3_status === "ENV_PASS").length, 16);
  assert.equal(dag.snapshot_counts.tools, 36);
  assert.equal(dag.snapshot_counts.ENV_PASS, 16);
  const counts = {};
  for (const t of dag.tools) counts[t.observed_r3_status] = (counts[t.observed_r3_status] ?? 0) + 1;
  for (const [status, count] of Object.entries(counts)) {
    assert.equal(dag.snapshot_counts[status], count, status);
  }
  assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), 36);
});

test("Tool Portfolio: gate precedence is a DAG and no tool silently passes real use", () => {
  const gates = dag.valid_gate_order;
  assert.deepEqual(gates.map((g) => g.id), ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
  acyclic(gates, "tool-gates");
  for (const t of dag.tools) {
    assert.equal(t.gate_status.T5, "NOT_QUALIFIED_REAL_SEMANTICS");
    assert.equal(t.gate_status.T4, "NOT_QUALIFIED_PR22");
    assert.equal(t.gate_status.T6, "OPEN_MAINTENANCE");
    if (t.observed_r3_status === "ENV_PASS") {
      assert.equal(t.gate_status.T3, "PASS_SCOPED_R3_FIXTURES");
    } else {
      assert.notEqual(t.gate_status.T3, "PASS_SCOPED_R3_FIXTURES");
    }
  }
  assert.equal(dag.snapshot_counts.fully_qualified_T5, 0);
});

test("Tool Portfolio: shared runtime refs and cross-tool repair DAG are complete", () => {
  const runtimes = new Set(dag.shared_runtimes.map((r) => r.id));
  assert.equal(runtimes.size, dag.shared_runtimes.length);
  assert.ok(runtimes.has("core"));
  for (const t of dag.tools) {
    for (const ref of t.requires) {
      if (ref.startsWith("tool:")) {
        assert.ok(dag.tools.some((x) => x.slug === ref.slice(5)));
        assert.notEqual(`tool:${t.slug}`, ref);
      } else {
        assert.ok(runtimes.has(ref), `${t.id}: invalid runtime ${ref}`);
      }
    }
  }
  acyclic(dag.shared_tasks, "shared-repair");
});
