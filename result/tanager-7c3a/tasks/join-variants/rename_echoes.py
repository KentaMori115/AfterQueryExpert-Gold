#!/usr/bin/env python3
"""Rename held-out cases whose titles read as instruction sentences.

ciChecks warns when a new test title appears nearly verbatim in instruction.md,
because an instruction that restates the test list reads as derived from the
tests. The fix is on the test side: aiCheck passed on the instruction text, and
re-voicing text that passed has failed that check before.

Each new name says which situation in the fixture is being read, rather than
restating the rule the instruction already states.
"""

import pathlib

REPO = pathlib.Path(__file__).resolve().parents[2] / "repo"

RENAMES = {
    "tests/join_forms.rs": {
        "right_join_keeps_unmatched_right_rows": "every_crew_survives_but_the_empty_depot_does_not",
        "right_join_pads_the_left_columns_with_null": "a_crew_with_no_depot_reports_no_depot_figures",
        "right_join_puts_unmatched_right_rows_last": "ravi_closes_the_result",
        "full_join_keeps_both_unmatched_sides": "the_empty_depot_and_the_lone_crew_both_appear",
        "full_join_orders_left_leftovers_before_right_leftovers": "north_comes_before_ravi",
        "cross_join_pairs_everything": "three_depots_against_four_crews_is_twelve_rows",
    },
    "tests/join_using.rs": {
        "merged_column_leads_the_output_row": "a_wildcard_starts_with_the_column_that_was_named",
        "merged_column_appears_once_under_a_wildcard": "depot_is_listed_once_not_twice",
        "a_bare_name_reaches_the_merged_column": "depot_resolves_with_no_qualifier",
        "either_qualifier_reaches_the_merged_column": "both_table_names_answer_for_depot",
        "merging_carries_whichever_side_is_present": "south_arrives_from_the_hub_side",
    },
}


def main() -> int:
    for rel, mapping in RENAMES.items():
        path = REPO / rel
        body = path.read_text()
        for old, new in mapping.items():
            needle = f"fn {old}()"
            if needle not in body:
                print(f"{rel}: no {needle}")
                return 1
            body = body.replace(needle, f"fn {new}()")
        path.write_text(body)
        print(f"{rel}: renamed {len(mapping)} cases")
    print("now rerun build_bundle.sh so config.json picks up the new ids")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
