#!/usr/bin/env python3
"""Four checks on the instruction and the graded suite, run rather than eyeballed.

1. every identifier a graded case touches is in the base checkout or is named by
   the instruction;
2. every value a graded case asserts on is one its own fixture put there, so no
   case pins a message or a name the request never promises;
3. every graded case maps to a rule the instruction states;
4. every rule the instruction states has at least one graded case.

Checks 3 and 4 are a table kept by hand below and asserted here: the mapping is
a judgement, but a case or a rule missing from the table is not.
"""
import pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE.parents[1] / "repo"
WORK = HERE.parents[1] / "work" / "tests"
GRADED = [WORK / "set_assignments.rs", WORK / "row_deletion.rs"]
INSTRUCTION = (HERE / "instruction.md").read_text()

base_text = "\n".join(p.read_text(errors="replace") for p in BASE.rglob("*.rs"))
base_text += (BASE / "README.md").read_text()

STD = set("""use mod fn let mut assert assert_eq assert_ne panic vec String Vec
usize i64 f64 bool str Some None Ok Err true false self crate super match if
else for in while return move ref as dyn impl struct enum pub const static type
where to_string into_iter iter map collect clone unwrap unwrap_err is_err
is_empty len push format print println test cfg derive expect first last rev
into from with_capacity sql db n other""".split())

# Rules the instruction states, and the graded cases that enforce each.
RULES = {
 "both statement forms parse": ["reports_the_rows_it_changed", "reports_the_rows_it_removed",
                                "the_table_is_named_after_from"],
 "no WHERE takes every row": ["without_a_where_it_takes_every_row",
                              "without_a_where_it_empties_the_table"],
 "only a TRUE predicate matches": ["only_rows_where_the_predicate_is_true@set_assignments",
                                   "only_rows_where_the_predicate_is_true@row_deletion",
                                   "a_false_predicate_changes_nothing",
                                   "a_null_predicate_column_keeps_its_row_out_of_every_form",
                                   "a_negated_predicate_still_needs_to_be_true",
                                   "an_unknown_predicate_can_be_asked_for_directly",
                                   "a_predicate_that_matches_nothing_reports_zero",
                                   "deleting_from_an_empty_table_reports_zero",
                                   "a_compound_predicate_selects_the_rows",
                                   "a_predicate_may_compare_two_columns",
                                   "deletes_can_follow_one_another"],
 "an alias qualifies columns": ["an_alias_qualifies_the_columns",
                                "an_alias_qualifies_the_predicate_columns"],
 "assignments read the pre-statement row": ["assignments_read_the_row_as_it_was",
                                            "one_assignment_cannot_see_another",
                                            "an_assignment_may_read_several_columns",
                                            "several_matched_rows_change_together"],
 "values land under the rules INSERT follows": ["an_integer_widens_into_a_float_column",
                                                "a_narrowing_value_is_a_type_error",
                                                "text_cannot_be_stored_in_an_integer_column",
                                                "a_null_into_a_not_null_column_rejects_the_statement",
                                                "a_computed_null_is_caught_the_same_way",
                                                "the_not_null_column_can_be_written_too"],
 "a row that cannot be computed or stored leaves the table as it was":
     ["one_bad_row_holds_back_the_good_ones",
      "a_value_that_cannot_be_computed_leaves_the_table_alone",
      "a_statement_that_fails_reports_nothing_at_all"],
 "nothing outside that table moves": ["an_update_touches_only_its_own_table",
                                      "a_delete_leaves_other_tables_alone"],
 "DELETE keeps survivors in stored order": ["survivors_keep_their_stored_order",
                                            "every_column_shrinks_together",
                                            "aggregates_over_the_table_follow_the_removal",
                                            "rows_added_after_a_delete_sit_behind_the_survivors"],
 "UPDATE writes rows where they sit": ["changed_rows_stay_where_they_were"],
 "Deleted(usize) counts rows removed": ["a_delete_runs_inside_a_script"],
 "Updated(usize) counts rows whose values differ":
     ["a_row_that_comes_out_identical_is_not_counted",
      "a_null_written_over_a_null_is_not_a_change",
      "a_mixed_statement_counts_only_the_rows_that_moved",
      "a_widened_value_that_differs_does_count",
      "an_update_runs_inside_a_script"],
 "Catalog for an unknown table": ["an_unknown_table_is_a_catalog_error@set_assignments",
                                  "an_unknown_table_is_a_catalog_error@row_deletion"],
 "Binder for an unknown column, a non-boolean WHERE, an aggregate, a column assigned twice":
     ["an_unknown_column_is_a_binder_error@set_assignments",
      "an_unknown_column_is_a_binder_error@row_deletion",
      "a_where_that_is_not_boolean_is_a_binder_error@set_assignments",
      "a_where_that_is_not_boolean_is_a_binder_error@row_deletion",
      "an_aggregate_has_no_place_in_an_update",
      "an_aggregate_has_no_place_in_a_delete",
      "assigning_one_column_twice_is_rejected"],
 "Type for a value the column cannot hold": ["a_narrowing_value_is_a_type_error",
                                             "text_cannot_be_stored_in_an_integer_column"],
}

problems = []
cases = []
for path in GRADED:
    text = path.read_text()
    stem = path.stem
    own = set(re.findall(r"fn ([a-z0-9_]+)\s*\(", text))
    cases += [(stem, name) for name in re.findall(r"#\[test\]\s*\nfn ([a-z0-9_]+)", text)]

    # Comments are prose, and a fixture's own table and column names are the
    # case's to choose. What has to come from somewhere is API surface: a type
    # or a method the case calls on the engine.
    code = re.sub(r"//[^\n]*", "", text)
    api = set(re.findall(r"\b([A-Z][A-Za-z0-9_]*)\b", code))
    api |= set(re.findall(r"\.([a-z_][a-z0-9_]*)\s*\(", code))
    api |= set(re.findall(r"::([a-z_][A-Za-z0-9_]*)\b", code))
    for name in sorted(api):
        if name in STD or name in own:
            continue
        if name in base_text or name in INSTRUCTION:
            continue
        problems.append(f"1: {stem}: `{name}` is in neither the base checkout nor the instruction")

    # Literals compared against a rendered value, rather than run as SQL.
    # Anything the case itself writes: a VALUES tuple, or a value a SET puts
    # there. Both are the case's own data, not a promise the engine made.
    fixture = "\n".join(line for line in text.splitlines()
                        if "VALUES" in line or re.match(r"\s+\(\d", line)
                        or "SET " in line or "THEN" in line)
    for lit in sorted(set(re.findall(r'"([^"\n]*)"', text))):
        if not lit or re.search(r"\b(SELECT|UPDATE|DELETE|INSERT|CREATE|WHERE|SET|FROM)\b", lit):
            continue
        if lit in ("NULL", "true", "false") or re.fullmatch(r"[-0-9.]+", lit):
            continue
        if lit.strip("'") in fixture or lit.rstrip("-x") in fixture:
            continue
        if "{:?}" in lit:      # a panic message this file writes for itself
            continue
        problems.append(f"2: {stem}: {lit!r} is asserted but no fixture puts it there")

mapped = {}
for rule, names in RULES.items():
    for entry in names:
        mapped.setdefault(entry.split("@")[0], []).append(rule)
for stem, name in cases:
    if name not in mapped:
        problems.append(f"3: {stem}::{name} enforces no rule the instruction states")
known = {n for stem, n in cases}
for rule, names in RULES.items():
    if not any(entry.split("@")[0] in known for entry in names):
        problems.append(f"4: no graded case enforces: {rule}")

for p in problems:
    print("FINDING:", p)
print(f"{len(cases)} graded cases, {len(RULES)} stated rules, {len(problems)} finding(s)")
sys.exit(1 if problems else 0)
