/**
 * I11 R109 C independent deterministic semantic reference. Exhaustively
 * enumerates EVERY simple path on a finite directed graph (<= 6 vertices).
 * This does not call or reuse the candidate's Dijkstra implementation.
 * Its only authority is the fixed, first-party finite graph test scope.
 */
export function enumerateSimplePaths(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length < 2 ||
      graph.nodes.length > 6 || !Array.isArray(graph.edges)) {
    return {status: "UNKNOWN", reason: "UNBOUNDED_OR_INVALID_GRAPH"};
  }
  const nodes = new Set(graph.nodes);
  if (nodes.size !== graph.nodes.length || !nodes.has(graph.start) ||
      !nodes.has(graph.goal)) return {status: "ERROR", reason: "BAD_VERTICES"};
  const adj = new Map(graph.nodes.map(n => [n, []]));
  for (const edge of graph.edges) {
    if (!Array.isArray(edge) || edge.length !== 3 ||
        !nodes.has(edge[0]) || !nodes.has(edge[1]) ||
        !Number.isSafeInteger(edge[2]) || edge[2] < 0 || edge[2] > 100) {
      return {status: "ERROR", reason: "BAD_EDGE"};
    }
    adj.get(edge[0]).push([edge[1], edge[2]]);
  }
  let min = Infinity, checked = 0;
  const dfs = (node, seen, cost) => {
    if (node === graph.goal) {
      checked++;
      if (cost < min) min = cost;
      return;
    }
    for (const [next, weight] of adj.get(node)) {
      if (!seen.has(next)) {
        const following = new Set(seen);
        following.add(next);
        dfs(next, following, cost + weight);
      }
    }
  };
  dfs(graph.start, new Set([graph.start]), 0);
  return checked > 0
    ? {status: "PROVEN", distance: min, paths_checked: checked}
    : {status: "UNKNOWN", reason: "UNREACHABLE"};
}
