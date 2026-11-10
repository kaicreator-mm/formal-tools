import networkx as nx

g = nx.Graph()
g.add_weighted_edges_from([(1, 2, 1.0), (2, 3, 2.0), (3, 4, 3.0)])
path = nx.dijkstra_path(g, 1, 4)
assert path == [1, 2, 3, 4], path
assert nx.dijkstra_path_length(g, 1, 4) == 6.0
bc = nx.betweenness_centrality(g)
assert abs(bc[2] - 0.5) < 1e-9, bc
print("PYVERIFY: OK SHORTEST_PATH")
