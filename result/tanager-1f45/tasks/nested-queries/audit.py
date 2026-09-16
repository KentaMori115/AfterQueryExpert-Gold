#!/usr/bin/env python3
"""Audit the graded suite against the instruction, both directions.

Four checks, because by eye this passed twice on earlier tasks and review
rejected it twice:

1. every API name the held-out cases touch exists at the BASE commit, so no
   case pins a name only the reference solution invented;
2. no case asserts an error message, only an error kind, since a message is a
   contract the request never states;
3. every held-out case is declared in config.json, so nothing runs ungraded;
4. every rule listed in CLAIMS below names at least one case that carries it,
   and every case is claimed by at least one rule.
"""

import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE.parents[1] / "repo"
HELD = [HERE / "build" / "tests" / "nested_reads.rs",
        HERE / "build" / "tests" / "enclosing_scope.rs"]

# rule from instruction.md -> the cases that carry it
CLAIMS = {
    "value position": ["a_query_in_a_value_position_supplies_its_single_value",
                       "a_value_query_feeds_arithmetic_like_any_other_value",
                       "a_value_query_reads_the_same_way_inside_case",
                       "a_value_query_reports_a_typed_column",
                       "a_value_query_can_stand_on_either_side_of_a_comparison"],
    "exists form": ["exists_is_true_as_soon_as_one_row_comes_back",
                    "exists_is_false_when_nothing_comes_back",
                    "not_exists_turns_the_answer_around"],
    "in form": ["in_over_a_query_tests_membership",
                "in_over_a_query_that_yields_nothing_keeps_no_rows",
                "a_membership_test_composes_with_the_rest_of_a_predicate",
                "membership_widens_across_the_numeric_types"],
    "read while running": ["a_query_used_as_a_value_is_not_folded_away_at_plan_time",
                           "the_enclosing_row_is_read_again_when_the_data_changes"],
    "one column": ["a_value_query_of_two_columns_is_rejected_before_it_runs",
                   "in_over_a_query_of_two_columns_is_rejected_before_it_runs"],
    "no rows is null": ["a_value_query_that_finds_nothing_reads_as_null",
                        "a_counting_query_over_no_rows_still_reads_as_zero"],
    "many rows errors": ["a_value_query_returning_several_rows_fails_while_running"],
    "exists never unknown": ["exists_does_not_care_what_the_rows_hold",
                             "exists_is_never_unknown_so_not_exists_covers_the_rest"],
    "inner rows are produced as usual": ["a_query_runs_far_enough_to_report_its_own_errors"],
    "miss with null is unknown": ["a_null_among_the_candidates_leaves_a_miss_unknown"],
    "null on the left": ["a_null_on_the_left_of_in_is_unknown"],
    "not in": ["not_in_finds_nothing_while_a_null_is_among_the_candidates",
               "not_in_works_once_the_candidates_are_free_of_nulls",
               "reaching_membership_keeps_its_three_valued_answer"],
    "comparable types": ["in_over_a_query_of_an_uncomparable_type_is_rejected",
                         "the_types_are_settled_before_any_row_is_read"],
    "inner tables first": ["the_inner_relations_are_consulted_first",
                           "qualifying_a_name_reaches_the_enclosing_relation",
                           "an_alias_on_the_enclosing_relation_is_the_name_to_reach_for",
                           "a_name_neither_query_offers_is_unknown"],
    "once per outer row": ["a_reaching_query_is_answered_once_for_each_outer_row",
                           "exists_over_a_reaching_query_filters_row_by_row",
                           "membership_over_a_reaching_query_filters_row_by_row",
                           "a_reaching_query_sees_the_joined_row_it_sits_on",
                           "reaching_and_self_contained_queries_nest_together",
                           "ordering_the_outer_query_does_not_disturb_the_reaching_one"],
    "no match reads null": ["a_reaching_query_that_matches_nothing_reads_null"],
    "one level only": ["only_the_query_immediately_around_it_is_visible"],
    "grouped row offers grouping columns": [
        "a_grouped_query_offers_its_grouping_columns_to_an_inner_query",
        "a_grouping_column_reaches_into_a_having_clause_too",
        "a_grouped_query_offers_nothing_but_its_grouping_columns",
        "a_self_contained_query_still_reads_the_same_under_grouping"],
    "explain shows the queries an operator runs": [
        "a_plan_shows_the_query_an_operator_runs",
        "the_query_a_filter_runs_hangs_under_that_filter",
        "a_plan_without_a_query_inside_reads_as_it_always_did",
        "every_query_an_operator_runs_is_shown"],
    "inner keeps its own clauses": ["an_aggregate_written_inside_belongs_to_the_inner_query",
                                    "a_reaching_aggregate_summarises_only_the_matching_rows",
                                    "a_reaching_query_may_order_and_limit_its_own_rows"],
    "anywhere an expression may": ["a_query_may_be_read_from_a_join_condition",
                                   "a_query_may_appear_in_the_select_list_and_the_predicate_at_once",
                                   "the_value_of_a_query_survives_ordering_and_limiting",
                                   "a_query_supplies_a_value_to_insert",
                                   "a_query_orders_the_rows_of_the_one_around_it",
                                   "a_query_stands_in_a_group_by_key"],
    "reaching predicate stays": ["a_reaching_predicate_stays_above_the_join_it_was_written_over",
                                 "where_a_predicate_ends_up_does_not_change_the_answer"],
    "self contained predicate moves": ["a_self_contained_predicate_is_free_to_move_into_an_input"],
}

problems = []
base_src = "\n".join(p.read_text() for p in BASE.rglob("*.rs"))
cases = []
api_names = set()
for path in HELD:
    text = path.read_text()
    cases += re.findall(r"#\[test\]\s*\nfn (\w+)", text)
    api_names |= set(re.findall(r"tanager::(?:\w+::)*(\w+)", text))
    api_names |= set(re.findall(r"ErrorKind::(\w+)", text))
    api_names |= set(re.findall(r"\.(\w+)\(", text))
    if re.search(r"err\.message\(\)|to_string\(\)\.contains", text):
        problems.append(f"{path.name} asserts on an error message")

ours = {"cells", "column", "plan", "shop", "depot", "unwrap", "unwrap_err", "unwrap_or_else",
        "remove", "collect", "iter", "map", "into_iter", "assert_eq", "is_empty", "len",
        "to_string", "position", "trim", "contains", "format", "vec", "push", "new", "get"}
for name in sorted(api_names - ours):
    if not re.search(r"\b(fn|struct|enum|pub fn)\s+%s\b" % re.escape(name), base_src) \
       and not re.search(r"\b%s\b" % re.escape(name), base_src):
        problems.append(f"case code names `{name}`, which the base checkout does not define")

declared = set(json.loads((HERE / "tests" / "config.json").read_text())["f2p_node_ids"])
declared_names = {node.split(".", 1)[1] for node in declared}
for case in cases:
    if case not in declared_names:
        problems.append(f"case {case} runs but is not declared in config.json")

claimed = {c for names in CLAIMS.values() for c in names}
for rule, names in CLAIMS.items():
    for name in names:
        if name not in cases:
            problems.append(f"rule '{rule}' names {name}, which is not a case")
for case in cases:
    if case not in claimed:
        problems.append(f"case {case} carries no rule from the instruction")

print(f"{len(cases)} cases, {len(CLAIMS)} rules, {len(declared)} declared ids")
for p in problems:
    print("PROBLEM:", p)
sys.exit(1 if problems else 0)
