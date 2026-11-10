import tree_sitter_language_pack as tlp

src = b"int main(void) { return 0; }\n"
tree = tlp.get_parser("c").parse(src)
root = tree.root_node
assert root.type == "translation_unit", root.type


def has_error(node):
    if node.type == "ERROR" or node.is_missing:
        return True
    return any(has_error(c) for c in node.children)


assert not has_error(root), "unexpected ERROR nodes in valid source"
print("PYVERIFY: OK PARSED")
