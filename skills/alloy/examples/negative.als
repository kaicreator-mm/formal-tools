sig Node { next: lone Node }
assert NoSelfLoop { no n: Node | n in n.next }
check NoSelfLoop for 4
