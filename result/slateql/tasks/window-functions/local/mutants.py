#!/usr/bin/env python3
"""Mutant sweep: each mutant changes one decision in the reference solution and
the held-out suite must fail at least one case.  Runs in work-window/ on the
solution branch with the two held-out files copied in as untracked files."""

import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[2] / "work-window"
TESTS = ["tests/test_ranked_events.py", "tests/test_depot_sales.py"]

WINDOW_OP = "slateql/execution/operators/window.py"
EXPR = "slateql/plan/expressions.py"
LOGICAL = "slateql/plan/logical.py"
BINDER = "slateql/analyze/binder.py"
TYPECHECK = "slateql/analyze/typecheck.py"
DEFS = "slateql/functions/window_defs.py"
PARSER_FRAME = "slateql/sql/parser.py"
VALIDATE = "slateql/analyze/validate.py"
PARSER = "slateql/sql/parser.py"

# Each mutant is a list of (file, before, after) edits applied together.
MUTANTS = {
    # rows leave in window order instead of the order they arrived in
    "emits_in_window_order": [(
        WINDOW_OP,
        "            for position, value in zip(ordered, computed):\n"
        "                values[position] = value",
        "            for slot, position in enumerate(positions):\n"
        "                values[position] = computed[slot]",
    )],
    # the call stops reporting the columns its partition and ordering read
    "window_call_hides_its_keys": [(
        EXPR,
        "    def children(self) -> Sequence[Expr]:\n"
        "        return (\n"
        "            *self.args,\n"
        "            *self.partition_by,\n"
        "            *(item.expression for item in self.order_by),\n"
        "        )",
        "    def children(self) -> Sequence[Expr]:\n        return self.args",
    )],
    # the node hides the columns its windows read from the pruner
    "window_hides_its_expressions": [(
        LOGICAL,
        "    def expressions(self) -> Sequence[Expr]:\n"
        "        return tuple(item.expression for item in self.functions)\n\n"
        '    def describe(self) -> str:\n        inner = ", ".join(item.describe() for item in self.functions)',
        "    def expressions(self) -> Sequence[Expr]:\n"
        "        return ()\n\n"
        '    def describe(self) -> str:\n        inner = ", ".join(item.describe() for item in self.functions)',
    )],
    # an ordered aggregate folds row by row instead of peer group by peer group
    "running_aggregate_ignores_peers": [(
        WINDOW_OP,
        "        if not call.order_by:\n            return [0]",
        "        if not call.order_by:\n            return [0]\n"
        "        return list(range(len(ordered)))",
    )],
    # RANK numbers rows rather than peer groups
    "rank_numbers_rows": [(
        DEFS,
        'value = group + 1 if key == "dense_rank" else start + 1',
        'value = group + 1 if key == "dense_rank" else group + 1',
    )],
    # DENSE_RANK skips the way RANK does
    "dense_rank_skips": [(
        DEFS,
        'value = group + 1 if key == "dense_rank" else start + 1',
        "value = start + 1",
    )],
    # null placement inside OVER stops following the session setting
    "null_placement_hardcoded": [(
        TYPECHECK,
        "                nulls_first=(\n"
        "                    item.nulls_first\n"
        "                    if item.nulls_first is not None\n"
        "                    else self.nulls_first_default\n"
        "                ),",
        "                nulls_first=False,",
    )],
    # PARTITION BY is parsed and then ignored
    "partitioning_ignored": [(
        WINDOW_OP,
        "        if not call.partition_by:\n            return [list(range(len(rows)))]",
        "        if True:\n            return [list(range(len(rows)))]",
    )],
    # DISTINCT and OVER are allowed together
    "distinct_over_allowed": [(
        PARSER,
        '            if distinct:\n                raise self._error("DISTINCT cannot be combined with OVER")\n',
        "",
    )],
    # a ranking call accepts arguments
    "ranking_takes_arguments": [(
        DEFS,
        '    if star or argument_count:\n        raise BindingError(f"{name}() takes no arguments")',
        "    if False:\n        raise BindingError(name)",
    )],
    # only the aggregates the examples happen to use accept an OVER clause
    "only_common_aggregates_windowed": [(
        TYPECHECK,
        "            definition = self.registry.aggregate(name)\n"
        "            if node.star and not definition.accepts_star:",
        "            if name not in ('count', 'sum', 'min', 'max', 'avg'):\n"
        "                raise BindingError(name)\n"
        "            definition = self.registry.aggregate(name)\n"
        "            if node.star and not definition.accepts_star:",
    )],
    # a ranking call binds without OVER, as if it were an ordinary scalar
    "bare_ranking_binds": [(
        TYPECHECK,
        "        if self.registry.is_aggregate(name):\n"
        "            return self._bind_aggregate(node)",
        "        if is_ranking(name):\n"
        "            return X.Literal(value=1, dtype=INTEGER.as_nullable(False))\n"
        "        if self.registry.is_aggregate(name):\n"
        "            return self._bind_aggregate(node)",
    )],
    # a frame still merges peers, the way an unframed aggregate does
    "frame_still_merges_peers": [(
        WINDOW_OP,
        '            elif call.frame is not None:\n                computed = self._framed(\n                    call, ordered, starts, rows, schema, context\n                )\n',
        '            elif call.frame is not None:\n                computed = self._running(\n                    call, ordered, starts, rows, schema, context\n                )\n',
    )],
    # the frame reaches one row too few
    "frame_off_by_one": [(
        WINDOW_OP,
        "            first = 0 if reach is None else max(0, position - reach)",
        "            first = 0 if reach is None else max(0, position - reach + 1)",
    )],
    # UNBOUNDED PRECEDING is read as the current row alone
    "unbounded_frame_is_one_row": [(
        WINDOW_OP,
        "            first = 0 if reach is None else max(0, position - reach)",
        "            first = position if reach is None else max(0, position - reach)",
    )],
    # a ranking call is allowed to carry a frame
    "ranking_frame_allowed": [(
        TYPECHECK,
        "            if is_ranking(name):\n"
        "                raise BindingError(\n"
        '                    f"{name}() cannot take a frame",',
        "            if False:\n"
        "                raise BindingError(\n"
        '                    f"{name}() cannot take a frame",',
    )],
    # a frame with nothing to count along is accepted
    "frame_without_order_allowed": [(
        TYPECHECK,
        "            if not node.spec.order_by:\n"
        "                raise BindingError(\n"
        '                    f"{name}() over a frame needs an ordering",',
        "            if False:\n"
        "                raise BindingError(\n"
        '                    f"{name}() over a frame needs an ordering",',
    )],
    # every window pulls the input again instead of sharing one pass
    "rescans_per_window": [(
        WINDOW_OP,
        "        for item in self._functions:\n"
        "            values = self._compute(item, rows, input_schema, evaluator, context)",
        "        for item in self._functions:\n"
        "            for _ in self.child.execute(context):\n"
        "                pass\n"
        "            values = self._compute(item, rows, input_schema, evaluator, context)",
    )],
    # the window node is built below the aggregate rather than above it
    "window_below_the_grouping": [(
        BINDER,
        "        plan = self._apply_windows(plan, projections, sort_specs)\n",
        "",
    )],
    "range_counts_rows": [(
        WINDOW_OP,
        '            if not frame.by_value:\n',
        '            if True:\n',
    )],
    "range_stops_at_the_current_row": [(
        WINDOW_OP,
        '                last = run_end[position]\n',
        '                last = position\n',
    )],
    "range_ignores_direction": [(
        WINDOW_OP,
        '                            if call.order_by[0].descending:\n',
        '                            if call.order_by[0].descending and False:\n',
    )],
    "range_null_row_reads_back": [(
        WINDOW_OP,
        '                    else:\n                        first = run_start[position]\n',
        '                    else:\n                        first = 0\n',
    )],
    "unbounded_range_counts_rows": [(
        WINDOW_OP,
        '            if not frame.by_value:\n',
        '            if not frame.by_value or reach is None:\n',
    )],
    "range_over_any_ordering": [(
        TYPECHECK,
        "        if frame is not None and frame.by_value and frame.preceding is not None:\n",
        "        if False:\n",
    )],
    "windows_cannot_fold_aggregates": [(
        TYPECHECK,
        "            if X.contains_window(arg):\n                raise BindingError(\"window functions cannot be nested\")\n",
        "            if X.contains_window(arg) or X.contains_aggregate(arg):\n                raise BindingError(\"window functions cannot be nested\")\n",
    )],
    "exclusion_ignored": [(
        WINDOW_OP,
        "                if index not in skipped:\n",
        "                if True:\n",
    )],
    "ties_take_the_row_too": [(
        WINDOW_OP,
        "                skipped.discard(position)\n",
        "                skipped.discard(-1)\n",
    )],
    "group_keeps_the_row": [(
        WINDOW_OP,
        "            elif frame.exclude == \"group\":\n                skipped = set(range(run_start[position], run_end[position] + 1))\n",
        "            elif frame.exclude == \"group\":\n                skipped = set(range(run_start[position], run_end[position] + 1)) - {position}\n",
    )],
    "exclusion_parsed_away": [(
        PARSER,
        "            exclude=self._parse_frame_exclusion(),\n",
        "            exclude=(self._parse_frame_exclusion(), None)[1],\n",
    )],
}


# Contract-equivalent, kept for the record: dropping BOTH guards still leaves
# every route raising (the evaluator cannot compile a window call), and the
# request promises only that a window outside SELECT and ORDER BY "is an
# error".  The graded cases assert exactly that, never which error, so this
# edit is not a behaviour change and no case can catch it.
EQUIVALENT = {
    "windows_allowed_anywhere": [
        (
            TYPECHECK,
            "        name = node.name.lower()\n        if not self.allow_windows:",
            "        name = node.name.lower()\n        if False:",
        ),
        (
            VALIDATE,
            "def _reject_windows(expression: Expr, context: str) -> None:\n"
            "    for inner in expression.walk():",
            "def _reject_windows(expression: Expr, context: str) -> None:\n"
            "    return\n    for inner in expression.walk():",
        ),
    ],
}


def run_suite() -> tuple[int, str]:
    """Return pytest's exit code and the last line it printed.

    The repository's own pyproject already passes ``-q``, so a second one
    silences the summary line: the exit code is what says whether the suite
    failed.
    """

    for cache in WORK.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    proc = subprocess.run(
        [sys.executable, "-B", "-m", "pytest", "-p", "no:cacheprovider", *TESTS],
        cwd=WORK, capture_output=True, text=True,
    )
    lines = [line for line in proc.stdout.strip().splitlines() if line.strip()]
    return proc.returncode, (lines[-1][:90] if lines else "")


def main() -> int:
    for name in TESTS:
        shutil.copy(HERE.parents[0] / "heldout" / pathlib.Path(name).name, WORK / name)
    code, tail = run_suite()
    print(f"unmutated: exit {code}  {tail}")
    if code != 0:
        print("*** the unmutated solution does not pass; fix that first")
        return 1
    bad = []
    for name, edits in MUTANTS.items():
        originals = {path: (WORK / path).read_text() for path, _, _ in edits}
        missing = [path for path, before, _ in edits if before not in originals[path]]
        if missing:
            print(f"{name:34s} *** anchor not found in {', '.join(missing)}")
            bad.append(name)
            continue
        for path, before, after in edits:
            target = WORK / path
            target.write_text(target.read_text().replace(before, after, 1))
        code, tail = run_suite()
        for path, text in originals.items():
            (WORK / path).write_text(text)
        caught = code != 0
        print(f"{name:34s} {'caught' if caught else '*** SURVIVED':12s} "
              f"exit {code}  {tail}")
        if not caught:
            bad.append(name)
    print(f"\n{len(MUTANTS) - len(bad)}/{len(MUTANTS)} mutants caught")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
