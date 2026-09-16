"""List the unittest ids of a selection of test files, as classname.name."""
import ast, json, os, sys

def declared(path):
    module = "tests." + os.path.basename(path)[:-3]
    tree = ast.parse(open(path, "rb").read())
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name.startswith("test"):
                    out.append("%s.%s.%s" % (module, node.name, item.name))
    return out

found = []
for path in sys.argv[1:]:
    found.extend(declared(path))
print(json.dumps(sorted(set(found)), indent=1))
