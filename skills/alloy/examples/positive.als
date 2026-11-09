sig Node { next: lone Node }
fact Acyclic { no n: Node | n in n.^next }
assert NoSelfLoop { no n: Node | n in n.next }
check NoSelfLoop for 4
