#!/usr/bin/env python3
"""Audit the instruction against the graded set, both directions at once.

Quality review has failed tasks in each direction: once for tests enforcing
what the request never stated, once for a request stating what nothing checked.
By eye it passed twice and was rejected twice, so it is a script.

Every claim the instruction makes is listed here with the graded ids that hold
it. The script then checks that every listed id exists in config.json and that
every f2p id in config.json is claimed by some sentence.
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
config = json.loads((HERE / "bundle" / "tests" / "config.json").read_text())
F2P = set(config["f2p_node_ids"])
P2P = set(config["p2p_node_ids"])

CLAIMS = {
    "the three operators exist, each plain and with ALL": [
        "branch_pairing.union_reports_each_row_once",
        "branch_pairing.union_all_keeps_every_copy",
        "branch_pairing.intersect_reports_shared_rows_once",
        "branch_pairing.intersect_all_keeps_the_smaller_count",
        "branch_pairing.except_drops_rows_the_other_branch_holds",
        "branch_pairing.except_all_cancels_one_copy_per_right_row",
    ],
    "branches combine by position: same count, columns must unify, else a binder error": [
        "branch_pairing.branches_of_different_widths_are_rejected",
        "branch_pairing.columns_that_do_not_unify_are_rejected",
        "branch_pairing.rows_pair_on_every_column",
    ],
    "names from the leftmost branch, type from the unification": [
        "branch_pairing.result_names_come_from_the_leftmost_branch",
        "branch_pairing.a_widened_branch_reports_the_wider_type",
        "bounded_branches.order_by_uses_the_leftmost_branch_names",
    ],
    "the narrow branch carries its values over, since rows pair by value and type": [
        "branch_pairing.a_narrow_branch_carries_its_values_over",
        "branch_pairing.widened_rows_pair_across_the_branches",
    ],
    "two rows are one when every column shares a group key, so NULL pairs with NULL": [
        "branch_pairing.a_null_pairs_with_a_null",
        "branch_pairing.a_null_row_survives_a_union",
    ],
    "the plain spellings report each survivor once": [
        "branch_pairing.union_reports_each_row_once",
        "branch_pairing.intersect_reports_shared_rows_once",
        "branch_pairing.except_drops_rows_the_other_branch_holds",
    ],
    "ALL counts: everything, the smaller count, left less right floored at zero": [
        "branch_pairing.union_all_keeps_every_copy",
        "branch_pairing.intersect_all_keeps_the_smaller_count",
        "branch_pairing.except_all_cancels_one_copy_per_right_row",
        "branch_pairing.except_all_floors_a_surplus_on_the_right_at_zero",
    ],
    "output follows the left branch in first-seen order, a union appending what is new": [
        "branch_pairing.a_union_follows_the_left_branch_then_appends",
        "branch_pairing.an_intersection_follows_the_left_branch",
        "branch_pairing.three_branches_chain_left_to_right",
    ],
    "a branch is still an ordinary SELECT: WHERE, GROUP BY and DISTINCT are its own": [
        "branch_pairing.a_filtered_branch_contributes_only_its_matching_rows",
        "branch_pairing.a_branch_may_group_and_aggregate",
        "branch_pairing.a_grouping_branch_collapses_only_its_own_rows",
        "branch_pairing.each_branch_counts_within_its_own_groups",
        "branch_pairing.grouped_branches_pair_on_their_group_rows",
        "branch_pairing.a_grouped_branch_meets_an_ungrouped_one",
        "branch_pairing.distinct_inside_a_branch_binds_to_that_branch",
    ],
    "INTERSECT pairs off first, the rest fold from the left": [
        "branch_pairing.intersect_binds_tighter_than_union",
        "branch_pairing.intersect_first_can_leave_fewer_rows_than_folding_left",
        "branch_pairing.equal_operators_fold_from_the_left",
    ],
    "the trailing clauses are written once, govern the whole result, and earlier is a parse error": [
        "bounded_branches.order_by_sorts_the_whole_result",
        "bounded_branches.limit_cuts_the_combined_result",
        "bounded_branches.offset_skips_into_the_second_branch",
        "bounded_branches.a_limit_after_an_offset_spans_both_branches",
        "bounded_branches.a_limit_reaching_past_the_first_branch_still_reads_the_second",
        "bounded_branches.order_by_before_the_last_branch_is_rejected",
        "bounded_branches.limit_before_the_last_branch_is_rejected",
        "bounded_branches.offset_before_the_last_branch_is_rejected",
        "bounded_branches.bounding_the_branches_does_not_move_a_row",
    ],
    "an ORDER BY key resolves against result columns, by name or by position": [
        "bounded_branches.order_by_a_position_picks_a_result_column",
        "bounded_branches.order_by_uses_the_leftmost_branch_names",
        "bounded_branches.order_by_a_column_outside_the_result_is_rejected",
    ],
    "EXPLAIN shows each operator as written": [
        "bounded_branches.explain_reports_the_operator_as_written",
    ],
    "a concatenation's branches take the limit plus the offset, and the outer limit stays": [
        "bounded_branches.a_concatenation_bounds_both_of_its_branches",
        "bounded_branches.the_bound_is_the_limit_plus_the_offset",
        "bounded_branches.the_outer_limit_stays_where_it_was",
        "bounded_branches.every_branch_of_a_chain_is_bounded",
    ],
    "nothing else is bounded, a Sort blocks it, and a bound branch is left alone": [
        "bounded_branches.a_deduplicating_union_leaves_its_branches_alone",
        "bounded_branches.an_intersection_leaves_its_branches_alone",
        "bounded_branches.a_difference_leaves_its_branches_alone",
        "bounded_branches.an_offset_with_no_limit_bounds_nothing",
        "bounded_branches.a_sort_between_the_limit_and_the_branches_blocks_the_bound",
        "bounded_branches.a_branch_is_bounded_only_once",
    ],
    # The one claim held by inherited cases rather than new ones: the public
    # entry points keep their shapes, which is what those suites assert.
    "Statement::Select still carries a SelectStmt and bind_select keeps its shape": [
        "parser_api.parses_a_select_into_expected_shape",
        "parser_api.parses_multiple_statements",
        "parser_api.explain_parses_to_explain_statement",
        "optimizer_effects.pushdown_changes_plan_shape_but_not_results",
    ],
}


def main() -> int:
    problems = []
    claimed = set()
    for claim, ids in CLAIMS.items():
        for node in ids:
            if node not in F2P and node not in P2P:
                problems.append(f"claim {claim!r} names {node}, which nothing grades")
            claimed.add(node)
    for node in sorted(F2P - claimed):
        problems.append(f"graded case {node} is not claimed by any sentence")
    for problem in problems:
        print("PROBLEM:", problem)
    if problems:
        return 1
    print(f"{len(CLAIMS)} claims, {len(claimed)} ids named, all {len(F2P)} f2p ids claimed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
