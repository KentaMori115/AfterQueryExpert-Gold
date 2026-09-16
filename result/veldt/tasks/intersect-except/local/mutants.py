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
IMG = "veldt-env:v1"
TESTS = ["tests/test_row_pairing.py", "tests/test_chain_folding.py"]

SETOP = "src/veldt/execution/operators/setop.py"
LOGICAL = "src/veldt/plan/logical.py"
COMPILER = "src/veldt/sql/compiler.py"
KEYWORDS = "src/veldt/sql/keywords.py"
STATS = "src/veldt/plan/stats.py"


MUTANTS = {
    # "a row ... survives min(m, n) times under INTERSECT"
    "intersect_all_stops_counting": (
        SETOP,
        """        remaining = counts.get(key, 0)
        if remaining == 0:
            return False
        counts[key] = remaining - 1
        return True""",
        """        remaining = counts.get(key, 0)
        if remaining == 0:
            return False
        return True""",
    ),
    # "and m - n times floored at zero under EXCEPT"
    "except_all_stops_counting": (
        SETOP,
        """        remaining = counts.get(key, 0)
        if remaining == 0:
            return True
        counts[key] = remaining - 1
        return False""",
        """        remaining = counts.get(key, 0)
        if remaining == 0:
            return True
        return False""",
    ),
    # "Each takes an optional ALL"
    "the_all_flag_is_dropped": (
        COMPILER,
        '            return Intersect(left, right, operation.all)',
        '            return Intersect(left, right, False)',
    ),
    # "Plain, every surviving row appears once." (intersection)
    "intersect_plain_keeps_duplicates": (
        SETOP,
        """        if not self.all:
            if key in emitted or counts.get(key, 0) == 0:
                return False
            emitted.add(key)
            return True""",
        """        if not self.all:
            return counts.get(key, 0) > 0""",
    ),
    # "Plain, every surviving row appears once." (difference)
    "except_plain_keeps_duplicates": (
        SETOP,
        """        if not self.all:
            if key in emitted or counts.get(key, 0) > 0:
                return False
            emitted.add(key)
            return True""",
        """        if not self.all:
            return counts.get(key, 0) == 0""",
    ),
    # "Rows pair by value and by type once both branches have been converted"
    "no_conversion_before_pairing": (
        SETOP,
        "        return batch if batch.schema == self._schema else batch.cast(self._schema)",
        "        return batch",
    ),
    # "Two nulls pair with each other"
    "a_null_pairs_with_nothing": (
        SETOP,
        """            for key in self._keys(self._align(batch)):
                counts[key] = counts.get(key, 0) + 1""",
        """            for key in self._keys(self._align(batch)):
                if ("null", None) in key:
                    continue
                counts[key] = counts.get(key, 0) + 1""",
    ),
    # "INTERSECT binds tightest"
    "intersect_binds_like_the_others": (
        KEYWORDS,
        '    "intersect": 2,',
        '    "intersect": 1,',
    ),
    # "UNION and EXCEPT sit level and read left to right"
    "level_operators_fold_from_the_right": (
        COMPILER,
        "            while pending and SET_OPERATOR_PRECEDENCE[pending[-1].kind] >= rank:",
        "            while pending and SET_OPERATOR_PRECEDENCE[pending[-1].kind] > rank:",
    ),
    # "ORDER BY, LIMIT and OFFSET written after the last select of a chain
    #  belong to the whole chain"
    "tail_clauses_stay_on_the_last_select": (
        COMPILER,
        """        tail = written[-1]
        written[-1] = dataclass_replace(tail, order_by=(), limit=None, offset=0)
        return [self._compile_select(item) for item in written], operators, tail""",
        """        tail = written[-1]
        return [self._compile_select(item) for item in written], operators, None""",
    ),
    # "each publishes what UNION publishes: left-hand names"
    "output_names_come_from_the_right": (
        LOGICAL,
        "        return self.left.schema.union(self.right.schema)",
        "        return self.right.schema.union(self.left.schema)",
    ),
    # "Mismatched column counts raise the planning error a bad UNION raises."
    "a_width_mismatch_is_waved_through": (
        COMPILER,
        "        if len(left.schema) != len(right.schema):",
        "        if False and len(left.schema) != len(right.schema):",
    ),
    # "EXPLAIN names each one the way it names a union"
    "explain_calls_an_intersection_a_union": (
        LOGICAL,
        '    keyword = "Intersect"',
        '    keyword = "Union"',
    ),
    # "Both drain the right side before emitting anything, so both report as
    #  blocking."
    "the_operators_do_not_report_blocking": (
        SETOP,
        """    @property
    def is_blocking(self) -> bool:
        \"\"\"True: nothing is emitted until the right input has been read.\"\"\"
        return True""",
        """    @property
    def is_blocking(self) -> bool:
        \"\"\"True: nothing is emitted until the right input has been read.\"\"\"
        return False""",
    ),
    # "veldt.plan.estimate has to cost them"
    "estimate_says_nothing_about_them": (
        STATS,
        """    if isinstance(plan, (Intersect, Except)):
        return _set_operation_statistics(plan)""",
        """    if isinstance(plan, (Intersect, Except)):
        return Statistics(None)""",
    ),
    # "an intersection at its smaller branch, a difference at left less right"
    "estimate_reads_only_the_left_branch": (
        STATS,
        """    if isinstance(plan, Intersect):
        if right.num_rows is None:
            return left.scaled(DEFAULT_SELECTIVITY)
        rows = min(left.num_rows, right.num_rows)
    else:
        if right.num_rows is None:
            return left.scaled(DEFAULT_SELECTIVITY)
        rows = max(left.num_rows - right.num_rows, 0)""",
        """    rows = left.num_rows""",
    ),
    # "the plain spelling scales it as a union's is"
    "estimate_does_not_scale_the_plain_spelling": (
        STATS,
        "    return Statistics(rows if plan.all else max(int(rows * 0.7), 0))",
        "    return Statistics(rows)",
    ),
    # "... floored at zero not one"
    "estimate_rounds_the_scaled_bound": (
        STATS,
        "    return Statistics(rows if plan.all else max(int(rows * 0.7), 0))",
        "    return Statistics(rows if plan.all else max(round(rows * 0.7), 0))",
    ),
    "estimate_floors_the_scaled_bound_at_one": (
        STATS,
        "    return Statistics(rows if plan.all else max(int(rows * 0.7), 0))",
        "    return Statistics(rows if plan.all else max(int(rows * 0.7), 1))",
    ),
    # "floored at zero"
    "estimate_lets_a_difference_go_negative": (
        STATS,
        "        rows = max(left.num_rows - right.num_rows, 0)",
        "        rows = left.num_rows - right.num_rows",
    ),
    # "ORDER BY ... keyed on combined output names" (an expression key, and the
    #  engine's own null placement, both have to survive the lift)
    "the_chain_sort_drops_its_direction": (
        COMPILER,
        "            plan = Sort(plan, tuple(tail.order_by))",
        "            plan = Sort(plan, tuple(SortKey(k.expression) for k in tail.order_by))",
    ),
    # "Answers must not move ... when batch size changes."
    "the_tally_restarts_on_every_batch": (
        SETOP,
        """        counts = self._tally(context)
        emitted: set = set()
        for batch in self.left.execute(context):""",
        """        emitted: set = set()
        for batch in self.left.execute(context):
            counts = self._tally(context)""",
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
