import networkx as nx

g = nx.Graph()
g.add_edge(1, 2)  # node 3 isolated
try:
    nx.dijkstra_path(g, 1, 3)
    print("PYVERIFY: FAIL expected NetworkXNoPath")
    raise SystemExit(3)
except nx.NetworkXNoPath:
    print("PYVERIFY: OK NO_PATH")
