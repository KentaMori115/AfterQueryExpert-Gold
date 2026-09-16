"""Tests for name resolution, type checking, and plan construction."""

from __future__ import annotations

import pytest

from slateql.errors import (
    AmbiguousColumnError,
    BindingError,
    TypeMismatchError,
    UnknownColumnError,
    UnknownTableError,
)
from slateql.plan.logical import Aggregate, Distinct, Filter, Join, Limit, Project, Sort
from slateql.plan.printer import format_plan
from slateql.types.datatypes import TypeKind


def plan_of(session, statement):
    return session.logical_plan(statement)


def test_star_expands_to_every_column(session):
    plan = plan_of(session, "SELECT * FROM customers")
    assert plan.schema.names == ["id", "name", "city", "signup_date", "active"]


def test_qualified_star_expands_one_relation(session):
    plan = plan_of(
        session,
        "SELECT c.* FROM customers c JOIN orders o ON o.customer_id = c.id",
    )
    assert plan.schema.names == ["id", "name", "city", "signup_date", "active"]


def test_star_without_from_is_rejected(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT *")


def test_unknown_table_is_reported(session):
    with pytest.raises(UnknownTableError):
        plan_of(session, "SELECT * FROM missing")


def test_unknown_column_is_reported(session):
    with pytest.raises(UnknownColumnError):
        plan_of(session, "SELECT nope FROM customers")


def test_unknown_alias_is_reported(session):
    with pytest.raises(BindingError) as info:
        plan_of(session, "SELECT x.id FROM customers c")
    assert "alias" in str(info.value)


def test_ambiguous_column_across_a_join(session):
    with pytest.raises(AmbiguousColumnError):
        plan_of(
            session,
            "SELECT id FROM customers c JOIN customers d ON c.id = d.id",
        )


def test_default_output_name_of_a_column_is_its_name(session):
    assert plan_of(session, "SELECT name FROM customers").schema.names == ["name"]


def test_default_output_name_of_an_aggregate(session):
    plan = plan_of(session, "SELECT COUNT(*) FROM customers")
    assert plan.schema.names == ["count(*)"]


def test_alias_overrides_the_derived_name(session):
    plan = plan_of(session, "SELECT COUNT(*) AS n FROM customers")
    assert plan.schema.names == ["n"]


def test_where_becomes_a_filter_node(session):
    plan = plan_of(session, "SELECT id FROM customers WHERE id > 1")
    assert any(isinstance(node, Filter) for node in plan.walk())


def test_non_boolean_where_is_rejected(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT id FROM customers WHERE id")


def test_aggregate_in_where_is_rejected(session):
    with pytest.raises(BindingError) as info:
        plan_of(session, "SELECT id FROM customers WHERE COUNT(*) > 1")
    assert "WHERE" in str(info.value)


def test_grouping_is_inferred_from_an_aggregate(session):
    plan = plan_of(session, "SELECT COUNT(*) FROM customers")
    assert any(isinstance(node, Aggregate) for node in plan.walk())


def test_ungrouped_column_alongside_an_aggregate_is_rejected(session):
    with pytest.raises(BindingError) as info:
        plan_of(session, "SELECT name, COUNT(*) FROM customers")
    assert "GROUP BY" in str(info.value)


def test_group_by_expression_can_be_reused_in_the_select_list(session):
    plan = plan_of(
        session,
        "SELECT UPPER(city) AS c, COUNT(*) FROM customers GROUP BY UPPER(city)",
    )
    assert plan.schema.names[0] == "c"


def test_group_by_ordinal_refers_to_the_select_list(session):
    by_name = plan_of(
        session, "SELECT city, COUNT(*) FROM customers GROUP BY city"
    )
    by_ordinal = plan_of(session, "SELECT city, COUNT(*) FROM customers GROUP BY 1")
    assert format_plan(by_name) == format_plan(by_ordinal)


def test_group_by_ordinal_out_of_range(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT city FROM customers GROUP BY 9")


def test_aggregate_in_group_by_is_rejected(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT city FROM customers GROUP BY COUNT(*)")


def test_nested_aggregates_are_rejected(session):
    with pytest.raises(BindingError) as info:
        plan_of(session, "SELECT SUM(COUNT(id)) FROM customers")
    assert "nested" in str(info.value)


def test_having_without_grouping_is_rejected(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT id FROM customers HAVING id > 1")


def test_having_becomes_a_filter_above_the_aggregate(session):
    plan = plan_of(
        session,
        "SELECT city, COUNT(*) FROM customers GROUP BY city HAVING COUNT(*) > 1",
    )
    nodes = list(plan.walk())
    filter_index = next(i for i, n in enumerate(nodes) if isinstance(n, Filter))
    aggregate_index = next(i for i, n in enumerate(nodes) if isinstance(n, Aggregate))
    assert filter_index < aggregate_index


def test_order_by_alias_resolves_to_the_projection(session):
    plan = plan_of(session, "SELECT id AS x FROM customers ORDER BY x")
    assert isinstance(plan, Sort)
    assert plan.schema.names == ["x"]


def test_order_by_ordinal_resolves_to_the_projection(session):
    plan = plan_of(session, "SELECT id FROM customers ORDER BY 1")
    assert isinstance(plan, Sort)


def test_order_by_ordinal_out_of_range(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT id FROM customers ORDER BY 3")


def test_order_by_a_hidden_column_prunes_it_again(session):
    plan = plan_of(session, "SELECT name FROM customers ORDER BY id")
    assert plan.schema.names == ["name"]
    assert isinstance(plan, Project)
    assert any(isinstance(node, Sort) for node in plan.walk())


def test_order_by_hidden_column_with_distinct_is_rejected(session):
    with pytest.raises(BindingError) as info:
        plan_of(session, "SELECT DISTINCT name FROM customers ORDER BY id")
    assert "DISTINCT" in str(info.value)


def test_distinct_adds_a_node(session):
    plan = plan_of(session, "SELECT DISTINCT city FROM customers")
    assert any(isinstance(node, Distinct) for node in plan.walk())


def test_limit_and_offset_become_one_node(session):
    plan = plan_of(session, "SELECT id FROM customers LIMIT 2 OFFSET 1")
    limit = next(node for node in plan.walk() if isinstance(node, Limit))
    assert (limit.count, limit.offset) == (2, 1)


def test_offset_without_limit_is_allowed(session):
    limit = next(
        node
        for node in plan_of(session, "SELECT id FROM customers OFFSET 2").walk()
        if isinstance(node, Limit)
    )
    assert limit.count is None and limit.offset == 2


def test_join_output_widens_nullability_on_the_padded_side(session):
    plan = plan_of(
        session,
        "SELECT c.id, o.order_id FROM customers c "
        "LEFT JOIN orders o ON o.customer_id = c.id",
    )
    assert plan.schema[1].dtype.nullable


def test_using_clause_becomes_an_equality(session):
    plan = plan_of(
        session,
        "SELECT c.id FROM customers c JOIN customers d USING (id)",
    )
    join = next(node for node in plan.walk() if isinstance(node, Join))
    assert join.condition is not None


def test_using_requires_the_column_on_both_sides(session):
    with pytest.raises(BindingError):
        plan_of(session, "SELECT 1 FROM customers c JOIN orders o USING (nope)")


def test_between_is_desugared_into_comparisons(session):
    plan = plan_of(session, "SELECT id FROM customers WHERE id BETWEEN 1 AND 3")
    predicate = next(
        node.predicate for node in plan.walk() if isinstance(node, Filter)
    )
    assert predicate.op == "AND"


def test_not_between_is_desugared_into_a_disjunction(session):
    plan = plan_of(session, "SELECT id FROM customers WHERE id NOT BETWEEN 1 AND 3")
    predicate = next(
        node.predicate for node in plan.walk() if isinstance(node, Filter)
    )
    assert predicate.op == "OR"


def test_case_branches_must_unify(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT CASE WHEN active THEN 1 ELSE 'x' END FROM customers")


def test_case_when_requires_a_boolean_condition(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT CASE WHEN id THEN 1 END FROM customers")


def test_cast_between_incompatible_types_is_rejected(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT CAST(active AS DATE) FROM customers")


def test_union_arity_mismatch_is_reported(session):
    with pytest.raises(Exception) as info:
        plan_of(session, "SELECT id FROM customers UNION SELECT id, name FROM customers")
    assert "columns" in str(info.value)


def test_union_unifies_column_types(session):
    plan = plan_of(
        session,
        "SELECT id FROM customers UNION ALL SELECT unit_price FROM orders",
    )
    assert plan.schema[0].dtype.kind is TypeKind.DOUBLE


def test_like_requires_string_operands(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT id FROM customers WHERE id LIKE 'a%'")


def test_comparison_of_incompatible_types_is_rejected(session):
    with pytest.raises(TypeMismatchError):
        plan_of(session, "SELECT id FROM customers WHERE name > 1")


def test_order_by_prefers_an_output_column_over_an_input_column(session):
    plan = plan_of(
        session,
        "SELECT city, SUM(id) AS id FROM customers GROUP BY city ORDER BY id DESC",
    )
    assert isinstance(plan, Sort)
    assert plan.keys[0].expression.name == "id"
    assert plan.keys[0].expression.qualifier is None


def test_order_by_still_reaches_input_columns_when_no_alias_matches(session):
    plan = plan_of(session, "SELECT name FROM customers ORDER BY id")
    assert plan.schema.names == ["name"]
