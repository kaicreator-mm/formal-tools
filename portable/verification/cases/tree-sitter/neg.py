import tree_sitter
import tree_sitter_c

lang = tree_sitter.Language(tree_sitter_c.language())
parser = tree_sitter.Parser(lang)

src = b"int main({ return 0 }\n"  # syntactically invalid C
tree = parser.parse(src)
root = tree.root_node


def has_error(node):
    if node.type == "ERROR" or node.is_missing:
        return True
    return any(has_error(c) for c in node.children)


assert has_error(root), "invalid source was not flagged as a parse error"
print("PYVERIFY: OK PARSE_ERROR_DETECTED")
