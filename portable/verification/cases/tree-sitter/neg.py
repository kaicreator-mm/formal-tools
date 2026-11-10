import tree_sitter_language_pack as tlp

src = b"int main({ return 0 }\n"  # syntactically invalid C
tree = tlp.get_parser("c").parse(src)
root = tree.root_node


def has_error(node):
    if node.type == "ERROR" or node.is_missing:
        return True
    return any(has_error(c) for c in node.children)


assert has_error(root), "invalid source was not flagged as a parse error"
print("PYVERIFY: OK PARSE_ERROR_DETECTED")
