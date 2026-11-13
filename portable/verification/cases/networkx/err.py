import networkx as nx

G = nx.Graph()
G.add_edge(1, 2)
nx.shortest_path(G, source="missing-node", target=2)
