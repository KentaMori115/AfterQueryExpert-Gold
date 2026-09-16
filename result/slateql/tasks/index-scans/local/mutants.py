#!/usr/bin/env python3
"""Mutant sweep: each mutant breaks one sentence of instruction.md and the
graded suite must fail at least one case.

The tree under test is the solution branch of ../../work with the two held-out
files copied in, materialised once into a scratch directory; each mutant edits
that copy, runs the two graded files in the env image, and is reverted.  A
mutant that survives means a promise the instruction makes is not graded.
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[2] / "work"
IMG = "slateql-env:v1"
TESTS = ["tests/test_index_catalog.py", "tests/test_index_access_paths.py"]

ACCESS = "slateql/execution/access_path.py"
SCAN = "slateql/execution/operators/index_scan.py"
INDEX = "slateql/storage/index.py"
TABLE = "slateql/storage/table.py"
CATALOG = "slateql/storage/catalog.py"
SESSION = "slateql/session.py"
PLANNER = "slateql/execution/planner.py"

MUTANTS = {
    # "create_index(table, column, kind="hash")" -- hash is the default
    "default_kind_is_sorted": (
        SESSION,
        '    def create_index(self, table: str, column: str, kind: str = "hash") -> Index:',
        '    def create_index(self, table: str, column: str, kind: str = "sorted") -> Index:',
    ),
    # "drop_index(table, column), which reports whether it removed anything"
    "drop_always_reports_true": (
        TABLE,
        "        return self._indexes.pop(name, None) is not None",
        "        self._indexes.pop(name, None)\n        return True",
    ),
    # "Building over a column that already carries an index replaces it."
    "second_index_does_not_replace": (
        TABLE,
        "        self._indexes[name] = index",
        "        self._indexes.setdefault(name, index)",
    ),
    # "An unknown table or column raises the same error a query would."
    "drop_unknown_column_is_silent": (
        TABLE,
        "        name = self.schema[self.schema.index_of(column)].name\n"
        "        return self._indexes.pop(name, None) is not None",
        "        return self._indexes.pop(column, None) is not None",
    ),
    # "SHOW INDEXES FROM t lists one table's"
    "show_indexes_ignores_the_table": (
        CATALOG,
        "        targets = [self.get(name)] if name else self.tables()\n"
        "        rows: list[tuple[str, IndexStats]] = []",
        "        targets = self.tables()\n"
        "        rows: list[tuple[str, IndexStats]] = []",
    ),
    # "ordered by table then column"
    "listing_in_registration_order": (
        CATALOG,
        "        for table in sorted(targets, key=lambda item: item.name):\n"
        "            for stats in sorted(table.index_stats(), key=lambda item: item.column):",
        "        for table in targets:\n"
        "            for stats in table.index_stats():",
    ),
    # "has_nulls reads YES or NO the way SHOW COLUMNS reports nullability"
    "has_nulls_is_a_boolean": (
        SESSION,
        '                    "YES" if stats.has_nulls else "NO",',
        "                    stats.has_nulls,",
    ),
    # "entries counts every row the index was built from, nulls included"
    "sorted_entries_skip_nulls": (
        INDEX,
        "        return IndexStats(\n"
        "            column=self._column,\n"
        "            entries=self._size,\n"
        "            distinct_keys=len(keys),",
        "        return IndexStats(\n"
        "            column=self._column,\n"
        "            entries=len(self._entries),\n"
        "            distinct_keys=len(keys),",
    ),
    # "A hash index answers ... IS NULL"
    "hash_cannot_serve_is_null": (
        ACCESS,
        '        if index.kind == "hash" and _is_null_test(conjunct, column, alias):',
        "        if False and _is_null_test(conjunct, column, alias):",
    ),
    # a sorted index holds no null entry, so it may not serve IS NULL
    "sorted_serves_is_null_too": (
        ACCESS,
        '        if index.kind == "hash" and _is_null_test(conjunct, column, alias):',
        "        if _is_null_test(conjunct, column, alias):",
    ),
    # "a sorted index answers equality, `IN` and ranges" -- the reviewer's
    # finding: a build that answers IN only from a hash index and full-scans
    # otherwise must not pass
    "sorted_refuses_an_in_list": (
        ACCESS,
        "        ok, keys = _in_keys(conjunct, column, alias)\n"
        "        if ok:",
        "        ok, keys = _in_keys(conjunct, column, alias)\n"
        '        if ok and index.kind == "hash":',
    ),
    # the equality half of the same promise
    "sorted_refuses_equality": (
        ACCESS,
        "        ok, value = _equality_key(conjunct, column, alias)\n"
        "        if ok:",
        "        ok, value = _equality_key(conjunct, column, alias)\n"
        '        if ok and index.kind == "hash":',
    ),
    # "A sorted index answers ... ranges"
    "hash_serves_ranges": (
        ACCESS,
        '    if index.kind != "sorted":\n        return None',
        "    if False:\n        return None",
    ),
    # "a single ORDER BY key"
    "two_sort_keys_served": (
        PLANNER,
        "        if len(plan.keys) != 1:\n            return None",
        "        if len(plan.keys) < 1:\n            return None",
    ),
    # "reading no further than the consumer asks"
    "ordered_read_is_not_lazy": (
        SCAN,
        "            buffer.append(row)\n"
        "            if len(buffer) >= size:",
        "            buffer.append(row)\n"
        "            if False:",
    ),
    # "Predicates an index cannot answer still get applied."
    "residual_dropped": (
        SCAN,
        "        predicates = [\n"
        "            evaluator.compile_predicate(expression, self._schema)\n"
        "            for expression in self._filters\n"
        "        ]",
        "        predicates = []",
    ),
    # "a key lookup beats a range"
    "range_beats_lookup": (
        ACCESS,
        "    for column in columns:\n"
        "        index = table.index_for(column)\n"
        "        found = _lookup_for(index, column, scan.alias, conjuncts)",
        "    for column in columns:\n"
        "        index = table.index_for(column)\n"
        "        found = _range_for(index, column, scan.alias, conjuncts)\n"
        "        if found is not None:\n"
        "            path, used = found\n"
        "            residual = [c for i, c in enumerate(conjuncts) if i not in set(used)]\n"
        "            return path, tuple(residual)\n"
        "        found = _lookup_for(index, column, scan.alias, conjuncts)",
    ),
    # "a range beats an ordered read"
    "ordered_read_beats_a_range": (
        ACCESS,
        "    for column in columns:\n"
        "        index = table.index_for(column)\n"
        "        found = _range_for(index, column, scan.alias, conjuncts)",
        "    if order is not None:\n"
        "        index = table.index_for(order.column)\n"
        '        if index is not None and index.kind == "sorted":\n'
        "            return (\n"
        "                OrderedPath(\n"
        "                    index=index,\n"
        "                    column=order.column,\n"
        "                    descending=order.descending,\n"
        "                    nulls_first=order.nulls_first,\n"
        "                ),\n"
        "                tuple(conjuncts),\n"
        "            )\n"
        "    for column in columns:\n"
        "        index = table.index_for(column)\n"
        "        found = _range_for(index, column, scan.alias, conjuncts)",
    ),
    # "within one rank the first indexed column in the table's schema wins"
    "tie_broken_by_build_order": (
        TABLE,
        "        return [field.name for field in self.schema if field.name in self._indexes]",
        "        return list(self._indexes)",
    ),
    # "Every statement returns the rows it returned before, in the order it
    # returned them" -- a lookup hands back offsets grouped by key
    "lookup_keeps_key_order": (
        ACCESS,
        "        finder = getattr(self.index, \"lookup_any\", None)\n"
        "        found = finder(self.keys) if finder else self.index.equal_any(self.keys)\n"
        "        return sorted(found)",
        "        finder = getattr(self.index, \"lookup_any\", None)\n"
        "        return finder(self.keys) if finder else self.index.equal_any(self.keys)",
    ),
    # the same promise for a range: a sorted index walks its entries by key
    "range_keeps_key_order": (
        ACCESS,
        "        if self.empty:\n            return []\n        return sorted(\n            self.index.range(",
        "        if self.empty:\n            return []\n        return list(\n            self.index.range(",
    ),
    # "in the order it returned them" -- rows sharing a key keep table order
    "descending_reverses_the_rows": (
        INDEX,
        "        ordered: list[int] = []\n        if descending:",
        "        ordered: list[int] = []\n        if descending and False:",
    ),
    # null placement inside an ordered read comes from the sort key
    "ordered_read_always_puts_nulls_last": (
        INDEX,
        "        return nulls + ordered if nulls_first else ordered + nulls",
        "        return ordered + nulls",
    ),
    # "A key or bound of NULL is unknown against every row, so that predicate
    # matches and reads nothing" -- the equality half, which is what every
    # Calibration II trial got wrong before the rule was stated
    "equality_against_null_scans_the_table": (
        ACCESS,
        "    if _is_column(conjunct.left, column, alias):\n"
        "        return _literal(conjunct.right)",
        "    if _is_column(conjunct.left, column, alias):\n"
        "        ok, value = _literal(conjunct.right)\n"
        "        return (ok and value is not None), value",
    ),
    # a null in an IN list matches nothing
    "in_list_matches_the_null_rows": [
        (ACCESS,
         "        if value is not None:\n            keys.append(value)",
         "        keys.append(value)"),
        (ACCESS,
         "    def offsets(self) -> list[int]:\n"
         "        if self.nulls:\n"
         "            return sorted(self.index.null_offsets())",
         "    def offsets(self) -> list[int]:\n"
         "        if self.nulls or any(key is None for key in self.keys):\n"
         "            return sorted(self.index.null_offsets())"),
    ],
    # a repeated key must not repeat its rows
    "in_list_repeats_a_repeated_key": (
        INDEX,
        "        seen: set[int] = set()\n"
        "        out: list[int] = []\n"
        "        for key in keys:\n"
        "            for offset in self.lookup(key):\n"
        "                if offset not in seen:\n"
        "                    seen.add(offset)\n"
        "                    out.append(offset)\n"
        "        return out",
        "        out: list[int] = []\n"
        "        for key in keys:\n"
        "            out.extend(self.lookup(key))\n"
        "        return out",
    ),
    # "rows_scanned ... counts the rows an access path really reads"
    "rows_scanned_counts_the_table": (
        SCAN,
        "            context.metrics.rows_scanned += 1",
        "            context.metrics.rows_scanned += len(index)",
    ),
    # a bound of NULL is not a bound: the predicate matches nothing
    "null_bound_ignored": (
        ACCESS,
        '        if value is None:\n            folded["empty"] = True\n            continue',
        "        if value is None:\n            continue",
    ),
}


def run_suite(tree: pathlib.Path) -> tuple[int, int]:
    for cache in tree.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    proc = subprocess.run(
        ["docker", "run", "--rm", "--network", "none", "-v", f"{tree}:/app", "-w", "/app",
         IMG, "python", "-B", "-m", "pytest", "-p", "no:cacheprovider", "-o", "addopts=", "-q", *TESTS],
        capture_output=True, text=True,
    )
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-300:]
    def count(word: str) -> int:
        found = re.search(r"(\d+) " + word, tail)
        return int(found.group(1)) if found else 0
    return count("failed") + count("error"), count("passed")


def main() -> int:
    branch = subprocess.run(
        ["git", "-C", str(WORK), "branch", "--show-current"],
        capture_output=True, text=True).stdout.strip()
    assert branch == "solution", f"work is on {branch!r}, expected 'solution'"

    tree = pathlib.Path(tempfile.mkdtemp(prefix="mutants-"))
    subprocess.run(f"git -C {WORK} archive solution | tar -x -C {tree}", shell=True, check=True)
    subprocess.run(
        f"git -C {WORK} archive heldout -- {' '.join(TESTS)} | tar -x -C {tree}",
        shell=True, check=True)

    ok = True
    try:
        for name, spec in MUTANTS.items():
            edits = spec if isinstance(spec, list) else [spec]
            originals = {}
            for path, old, new in edits:
                target = tree / path
                text = originals.get(path, target.read_text())
                assert text.count(old) == 1, (name, path, text.count(old))
                originals.setdefault(path, text)
                target.write_text(target.read_text().replace(old, new))
            try:
                failed, passed = run_suite(tree)
            finally:
                for path, text in originals.items():
                    (tree / path).write_text(text)
            ok = ok and failed > 0
            verdict = "caught" if failed else "*** SURVIVED ***"
            print(f"{name:36s} failed={failed:3d} passed={passed:3d}  {verdict}")
        failed, passed = run_suite(tree)
        print(f"{'(restored solution)':36s} failed={failed:3d} passed={passed:3d}")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    return 0 if ok and failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
