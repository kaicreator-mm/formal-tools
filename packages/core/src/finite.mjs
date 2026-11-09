/**
 * Pure JavaScript formal checks for explicitly bounded models.
 * No Node.js APIs, WebAssembly, network, filesystem, or external solver.
 * Does NOT replace Lean, cvc5, Z3 or other native theorem provers.
 */
const LIMIT = 1000;
const MAX_CNF_VARS = 18;

function strings(items, label, max = LIMIT) {
  if (!Array.isArray(items) || items.length > max ||
      items.some(v => typeof v !== "string" || !v.length) ||
      new Set(items).size !== items.length) {
    throw new TypeError(label + ": expected distinct, nonempty strings, max " + max);
  }
  return items;
}
function edges(items, nodes) {
  if (!Array.isArray(items) || items.length > 10000 ||
      items.some(e => !Array.isArray(e) || e.length !== 2 ||
        !nodes.has(e[0]) || !nodes.has(e[1]))) {
    throw new TypeError("edges: expected <= 10000 pairs of known nodes");
  }
  return items;
}
const envelope = (toolOutcome, testVerdict, fields) => ({
  tool_outcome: toolOutcome,
  test_verdict: testVerdict,
  claim_verdict: "NOT_EVALUATED",
  execution: "PURE_JS",
  ...fields
});

/** DFS finds a concrete cycle or a topological order for a complete finite graph. */
export function analyzeDag({ nodes, edges: arcList }) {
  const names = strings(nodes, "nodes");
  const arcs = edges(arcList, new Set(names));
  const out = new Map(names.map(n => [n, []]));
  for (const [a, b] of arcs) out.get(a).push(b);
  for (const a of out.values()) a.sort();
  const state = new Map(names.map(n => [n, 0]));
  const stack = [];
  const order = [];
  let cycle = null;
  function visit(n) {
    state.set(n, 1);
    stack.push(n);
    for (const next of out.get(n)) {
      if (state.get(next) === 0 && visit(next)) return true;
      if (state.get(next) === 1) {
        cycle = stack.slice(stack.indexOf(next)).concat(next);
        return true;
      }
    }
    stack.pop();
    state.set(n, 2);
    order.push(n);
    return false;
  }
  for (const n of [...names].sort()) {
    if (state.get(n) === 0 && visit(n)) break;
  }
  return cycle
    ? envelope("CYCLE_FOUND", "COUNTEREXAMPLE", { cycle, node_count: names.length, edge_count: arcs.length, scope: "complete supplied finite graph" })
    : envelope("ACYCLIC", "PASS", { topological_order: order.reverse(), node_count: names.length, edge_count: arcs.length, scope: "complete supplied finite graph" });
}

/** Same resource and logical slot must have at most one distinct task as writer. */
export function checkExclusiveWriters({ claims }) {
  if (!Array.isArray(claims) || claims.length > 10000) throw new TypeError("claims: expected <= 10000 entries");
  const buckets = new Map();
  for (const item of claims) {
    if (!item || typeof item !== "object" ||
        ["task", "resource", "slot"].some(k => typeof item[k] !== "string" || !item[k].length)) {
      throw new TypeError("claim: task/resource/slot must be nonempty strings");
    }
    const key = JSON.stringify([item.resource, item.slot]);
    if (!buckets.has(key)) buckets.set(key, { resource: item.resource, slot: item.slot, tasks: new Set() });
    buckets.get(key).tasks.add(item.task);
  }
  const conflicts = [...buckets.values()]
    .filter(v => v.tasks.size > 1)
    .map(v => ({ resource: v.resource, slot: v.slot, tasks: [...v.tasks].sort() }))
    .sort((a, b) => a.resource.localeCompare(b.resource) || a.slot.localeCompare(b.slot));
  return envelope(conflicts.length ? "WRITE_CONFLICT" : "EXCLUSIVE", conflicts.length ? "COUNTEREXAMPLE" : "PASS",
    { conflicts, claims_examined: claims.length, scope: "supplied resource/time-slot writer claims; not inferred concurrency" });
}

/** Exact propositional SAT on at most 18 Boolean variables, using DPLL pruning. */
export function solveCnf({ variables, clauses }) {
  if (!Number.isInteger(variables) || variables < 0) throw new TypeError("variables must be a nonnegative integer");
  if (variables > MAX_CNF_VARS) return envelope("UNKNOWN", "INCONCLUSIVE", { reason: "variable limit 18", variables, scope: "bounded Boolean CNF" });
  if (!Array.isArray(clauses) || clauses.length > 10000) throw new TypeError("clauses: expected <= 10000 clauses");
  for (const clause of clauses) {
    if (!Array.isArray(clause) || clause.length > 500 ||
        clause.some(lit => !Number.isInteger(lit) || lit === 0 || Math.abs(lit) > variables)) {
      throw new TypeError("CNF literal outside 1..variables or oversized clause");
    }
  }
  const a = Array(variables).fill(null);
  let explored = 0;
  let steps = 0;
  let budgetExceeded = false;
  const step = () => { if (++steps > 200000) { budgetExceeded = true; return false; } return true; };
  function partial() {
    let all = true;
    for (const clause of clauses) {
      if (!step()) return -1;
      let yes = false, undecided = false;
      for (const lit of clause) {
        if (!step()) return -1;
        const v = a[Math.abs(lit) - 1];
        if (v === null) undecided = true;
        else if (v === (lit > 0)) { yes = true; break; }
      }
      if (!yes && !undecided) return -1;
      if (!yes) all = false;
    }
    return all ? 1 : 0;
  }
  function search(depth) {
    if (budgetExceeded) return null;
    explored++;
    const p = partial();
    if (p < 0) return null;
    if (p > 0) return a.map(v => v ?? false);
    if (depth === variables) return null;
    a[depth] = false;
    const left = search(depth + 1);
    if (left) return left;
    a[depth] = true;
    const right = search(depth + 1);
    a[depth] = null;
    return right;
  }
  const model = search(0);
  if (budgetExceeded) return envelope("UNKNOWN", "INCONCLUSIVE", { variables, explored, steps, reason: "operation budget 200000 exceeded", scope: "bounded Boolean CNF" });
  return model
    ? envelope("SAT", "PASS", { model, variables, explored, scope: "all finite assignments within declared Boolean variables; SAT = existence of model" })
    : envelope("UNSAT", "PASS", { variables, explored, scope: "all finite assignments within declared Boolean variables; UNSAT = no model" });
}

/** Exhaustively visit reachable states of a supplied finite transition graph. */
export function verifyFiniteState({ states, initial, transitions, allowedStates }) {
  const names = strings(states, "states");
  const known = new Set(names);
  if (!known.has(initial)) throw new TypeError("unknown initial state");
  const arcs = edges(transitions, known);
  const allowed = new Set(strings(allowedStates, "allowedStates"));
  if ([...allowed].some(x => !known.has(x))) throw new TypeError("unknown allowed state");
  const out = new Map(names.map(n => [n, []]));
  for (const [src, dst] of arcs) out.get(src).push(dst);
  const visited = new Set([initial]);
  const paths = [[initial]];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i], current = path[path.length - 1];
    if (!allowed.has(current)) return envelope("INVARIANT_VIOLATED", "COUNTEREXAMPLE", {
      path, explored: visited.size, scope: "reachable states in explicit finite graph"
    });
    for (const next of out.get(current)) {
      if (!visited.has(next)) {
        visited.add(next);
        paths.push([...path, next]);
      }
    }
  }
  return envelope("SAFE_FINITE", "PASS", { explored: visited.size, scope: "all reachable states in explicit finite graph" });
}

export const ENGINES = Object.freeze({
  dag: analyzeDag,
  writers: checkExclusiveWriters,
  cnf: solveCnf,
  states: verifyFiniteState
});

export function verifyPure(kind, model) {
  if (!Object.prototype.hasOwnProperty.call(ENGINES, kind)) throw new TypeError("unsupported pure-JS engine");
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new TypeError("model must be an object");
  return ENGINES[kind](model);
}
