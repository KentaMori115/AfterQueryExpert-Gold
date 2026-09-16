#!/usr/bin/env python3
"""Break the reference on purpose and check the graded suite notices.

Every entry is a defensible wrong reading of the request.  A survivor is a
rule the instruction states but no held-out case enforces.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
DEV = HERE / "work" / "dev"
PY = pathlib.Path("/root/mindriftwork/AQ_dragan/result/cueforge/.venv/bin/python")

YAML = "src/cueforge/production/yaml_loader.py"
JSONL = "src/cueforge/production/json_loader.py"
BUILD = "src/cueforge/production/build.py"
REFS = "src/cueforge/production/references.py"
LOC = "src/cueforge/production/locate.py"
DISC = "src/cueforge/production/discovery.py"
SMAP = "src/cueforge/production/source_map.py"
CHECK = "src/cueforge/assertions/check.py"
CLI = "src/cueforge/cli/commands.py"
API = "src/cueforge/api.py"

MUTANTS: dict[str, list[tuple[str, str, str]]] = {
    "alias points at the anchor": [
        (YAML, "        if isinstance(event, AliasEvent):\n", "        if False and isinstance(event, AliasEvent):\n")],
    "alias covers the node but not what is inside it": [
        (YAML, "                loader, value_node, positions, path, (*at, key), through\n", "                loader, value_node, positions, path, (*at, key), None\n")],
    "keys inside an alias keep their own position": [
        (YAML, "                (*at, key), through if through is not None else _ref(key_node.start_mark, path)\n", "                (*at, key), _ref(key_node.start_mark, path)\n")],
    "nested aliases point at the innermost": [
        (YAML, "    if through is None and alias_mark is not None:\n", "    if alias_mark is not None:\n")],
    "anchored nodes open at the anchor": [
        (YAML, "            node.start_mark = _content_mark(event.start_mark)\n", "            pass\n")],
    "compile json prints a null source": [
        (CLI, '    source = getattr(item, "source", None)\n    if source is not None:\n', '    source = getattr(item, "source", None)\n    payload["source"] = None\n    if source is not None:\n')],
    "yaml lines and columns are 0-based": [
        (YAML, "line=mark.line + 1, column=mark.column + 1", "line=mark.line, column=mark.column")],
    "yaml columns are 0-based": [
        (YAML, "line=mark.line + 1, column=mark.column + 1", "line=mark.line + 1, column=mark.column")],
    "json columns count from 0": [
        (JSONL, "        self.column = 1\n", "        self.column = 0\n")],
    "json escapes are measured after decoding": [
        (JSONL, '''            if char == "\\\\":
                self.advance()
                escape = self.peek()
                if escape == "u":
                    pieces.append(self.unicode_escape())
                    continue''', '''            if char == "\\\\":
                self.advance()
                escape = self.peek()
                if escape == "u":
                    pieces.append(self.unicode_escape())
                    self.column -= 5
                    continue''')],
    "json repeated key keeps the first value position": [
        (JSONL, "        self.positions.add_value(node, start)\n",
         "        if node not in self.positions.values:\n            self.positions.add_value(node, start)\n")],
    "unknown field points at the mapping, not the key": [
        (BUILD, 'return positions.key(path) or positions.nearest(path[:-1])', 'return positions.nearest(path[:-1])')],
    "missing field points at the document root": [
        (BUILD, 'return positions.nearest(path[:-1])\n    return positions.nearest(path)', 'return positions.value(())\n    return positions.nearest(path)')],
    "unsupported version has no position": [
        (BUILD, 'source=positions.value(("version",)) if positions is not None else None,', 'source=None,')],
    "duplicate cue id points at the first copy": [
        (REFS, '), value("cues", index, "id"))\n            )\n        else:', '), value("cues", seen_cues[cue.id], "id"))\n            )\n        else:')],
    "missing after points at the cue, not the value": [
        (REFS, 'value("cues", index, "trigger", "after"))', 'value("cues", index))')],
    "unknown uses item points at the uses list": [
        (REFS, 'value("cues", index, "uses", position))', 'value("cues", index, "uses"))')],
    "requires resource points at the requires entry": [
        (REFS, 'value("cues", index, "requires", position, "resource"))', 'value("cues", index, "requires", position))')],
    "action references point at the action mapping": [
        (REFS, 'value("cues", index, "action", "move"))', 'value("cues", index, "action"))'),
        (REFS, 'value("cues", index, "action", field_name))', 'value("cues", index, "action"))')],
    "bad identifier keys point at the entry value": [
        (REFS, 'key(section, name))', 'value(section, name))')],
    "assertions are not checked at compile time": [
        (REFS, '    for index, finding in check_assertions(production):\n        findings.append(located(finding, value("assertions", index, "expression")))\n', '')],
    "assertion findings point at the assertion entry": [
        (REFS, 'value("assertions", index, "expression"))', 'value("assertions", index))')],
    "undeclared states are accepted": [
        (CHECK, 'elif expr.expected not in allowed_states(production, expr.resource_id):', 'elif False:')],
    "unknown attributes are accepted": [
        (CHECK, 'if attr.attr not in CUE_ATTRIBUTES:', 'if False:')],
    "cycle points at the last id in the witness": [
        (LOC, 'first = cycle[0] if cycle and cycle[0] else subject', 'first = cycle[-1] if cycle and cycle[-1] else subject')],
    "self dependency points at the trigger mapping": [
        (LOC, 'elif code in {"CF3001", "CF3003"}:\n        path = _trigger_path(finding, cue_index, "after")', 'elif code in {"CF3001", "CF3003"}:\n        path = _trigger_path(finding, cue_index)')],
    "reservation conflict points at the resource value": [
        (LOC, 'ref = positions.key(("resources", subject))', 'ref = positions.value(("resources", subject))')],
    "no-cues finding points at the cues key": [
        (LOC, 'elif code == "CF3006":\n        path = ("cues",)', 'elif code == "CF3006":\n        ref = positions.key(("cues",))')],
    "short duration points at the action": [
        (LOC, 'path = ("cues", cue_index[subject], "duration")', 'path = ("cues", cue_index[subject], "action")')],
    "incomplete move points at the cue": [
        (LOC, 'path = ("cues", cue_index[subject], "action")', 'path = ("cues", cue_index[subject])')],
    "compile findings are not located at all": [
        (API, 'findings = locate_findings(raw_findings, production)', 'findings = list(raw_findings)')],
    "offset points at the trigger": [
        (LOC, '"offset": ("trigger", "offset"),', '"offset": ("trigger",),')],
    "capacity finding points at the resource": [
        (LOC, 'path = ("resources", subject, "capacity")', 'path = ("resources", subject)')],
    "workspace nodes point at the manifest": [
        (DISC, 'document, parse_finding, positions = parse_document_with_positions(path, read_text(path), rel)', 'document, parse_finding, positions = parse_document_with_positions(path, read_text(path), "cueforge.yaml")')],
    "merged lists are not renumbered": [
        (DISC, '                offsets[key] = lengths.get(key, 0)\n', '                offsets[key] = 0\n')],
    "duplicate across files points at the first file": [
        (DISC, 'second = witness.get("second_path") or witness.get("path")', 'second = witness.get("first_path") or witness.get("path")')],
    "sources problems have no position": [
        (DISC, 'findings = _locate_discovery(discover_findings, manifest)', 'findings = list(discover_findings)')],
    "parse errors have no position": [
        (DISC, 'source=_error_ref(exc, rel),', 'source=None,')],
    "a relative path is reported absolute": [
        (DISC, '        rel = posix_relpath(str(root))\n        document, parse_finding, positions = parse_document_with_positions(root, read_text(root), rel)',
         '        rel = posix_relpath(str(root.resolve()))\n        document, parse_finding, positions = parse_document_with_positions(root, read_text(root), rel)')],
    "compile json never prints source": [
        (CLI, '    if source is not None:\n        payload["source"] = {', '    if False:\n        payload["source"] = {')],
    "quoted scalars point past the quote": [
        (YAML, 'return SourceRef(path=path, line=mark.line + 1, column=mark.column + 1)',
         'return SourceRef(path=path, line=mark.line + 1, column=mark.column + (2 if node.style in (\'"\', "\'") else 1))')],
    "nearest enclosing node is used for every value": [
        (LOC, 'ref = positions.value(path) if path[-1] == "cues" or len(path) == 1 else positions.nearest(path)', 'ref = positions.nearest(path[:-1])')],
}


def run(tree: pathlib.Path) -> tuple[int, str]:
    out = subprocess.run(
        [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", "tests/locations"],
        cwd=tree, capture_output=True, text=True, env={"PYTHONPATH": "src", "PATH": "/usr/bin:/bin"},
    )
    tail = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else out.stderr[-200:]
    failed = out.stdout.count("FAILED ")
    return failed, tail


def main() -> int:
    survivors = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, edits in MUTANTS.items():
            if sys.argv[1:] and not any(word in name for word in sys.argv[1:]):
                continue
            target = pathlib.Path(tmp) / "mut"
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(DEV, target, ignore=shutil.ignore_patterns(".git", "__pycache__", ".hypothesis"))
            for rel, old, new in edits:
                path = target / rel
                text = path.read_text()
                if old not in text:
                    print(f"  !! mutant '{name}': anchor not found in {rel}")
                    survivors.append(name + " (anchor missing)")
                    break
                path.write_text(text.replace(old, new, 1))
            else:
                failed, tail = run(target)
                status = "caught" if failed else "SURVIVED"
                print(f"{status:9} {failed:3d}  {name}")
                if not failed:
                    survivors.append(name)
    print()
    print("survivors:", survivors or "none")
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
