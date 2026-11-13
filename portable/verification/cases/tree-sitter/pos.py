import tree_sitter
import tree_sitter_c

lang = tree_sitter.Language(tree_sitter_c.language())
parser = tree_sitter.Parser(lang)

src = b"int main(void) { return 0; }\n"
tree = parser.parse(src)
root = tree.root_node
assert root.type == "translation_unit", root.type


def has_error(node):
    if node.type == "ERROR" or node.is_missing:
        return True
    return any(has_error(c) for c in node.children)


assert not has_error(root), "unexpected ERROR nodes in valid source"
print("PYVERIFY: OK PARSED")
