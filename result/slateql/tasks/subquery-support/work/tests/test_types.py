"""Tests for the type system and value conversion."""

from __future__ import annotations

import datetime as dt

import pytest

from slateql.errors import ExecutionError, SchemaError, TypeMismatchError
from slateql.types.coercion import (
    can_implicitly_cast,
    common_type,
    explicit_cast_allowed,
    require_numeric,
    result_of_arithmetic,
    unify,
)
from slateql.types.datatypes import (
    BOOLEAN,
    DATE,
    DOUBLE,
    INTEGER,
    NULL,
    STRING,
    TIMESTAMP,
    DataType,
    TypeKind,
    parse_type_name,
    type_from_python,
)
from slateql.types.values import cast_value, infer_column_type, parse_timestamp


def test_type_names_are_upper_case():
    assert INTEGER.name == "INTEGER"
    assert str(INTEGER.as_nullable(False)) == "INTEGER NOT NULL"


def test_type_aliases_resolve():
    assert parse_type_name("bigint").kind is TypeKind.INTEGER
    assert parse_type_name("varchar").kind is TypeKind.STRING
    assert parse_type_name("datetime").kind is TypeKind.TIMESTAMP


def test_unknown_type_name_is_rejected():
    with pytest.raises(SchemaError):
        parse_type_name("blob")


def test_bool_is_typed_before_int():
    assert type_from_python(True) is BOOLEAN
    assert type_from_python(1) is INTEGER


def test_integer_widens_to_double_but_not_the_reverse():
    assert can_implicitly_cast(INTEGER, DOUBLE)
    assert not can_implicitly_cast(DOUBLE, INTEGER)


def test_date_widens_to_timestamp():
    assert can_implicitly_cast(DATE, TIMESTAMP)


def test_null_widens_to_anything():
    assert can_implicitly_cast(NULL, STRING)


def test_common_type_picks_the_wider_side():
    assert common_type(INTEGER, DOUBLE).kind is TypeKind.DOUBLE
    assert common_type(STRING, INTEGER) is None


def test_common_type_with_null_keeps_the_other_side_nullable():
    merged = common_type(NULL, INTEGER.as_nullable(False))
    assert merged.kind is TypeKind.INTEGER
    assert merged.nullable


def test_unify_rejects_incompatible_branches():
    with pytest.raises(TypeMismatchError):
        unify([STRING, INTEGER], context="CASE")


def test_unify_of_nothing_is_null():
    assert unify([]) is NULL


def test_division_always_produces_double():
    assert result_of_arithmetic("/", INTEGER, INTEGER).kind is TypeKind.DOUBLE


def test_integer_arithmetic_stays_integral():
    assert result_of_arithmetic("+", INTEGER, INTEGER).kind is TypeKind.INTEGER


def test_concat_requires_strings():
    with pytest.raises(TypeMismatchError):
        result_of_arithmetic("||", INTEGER, STRING)


def test_require_numeric_rejects_strings():
    with pytest.raises(TypeMismatchError):
        require_numeric(STRING, context="test")


def test_explicit_cast_matrix():
    assert explicit_cast_allowed(STRING, DATE)
    assert not explicit_cast_allowed(BOOLEAN, DATE)


def test_cast_value_returns_none_on_failure():
    assert cast_value("nope", INTEGER) is None


def test_cast_value_raises_in_strict_mode():
    with pytest.raises(ExecutionError):
        cast_value("nope", INTEGER, strict=True)


def test_cast_null_is_always_null():
    assert cast_value(None, INTEGER, strict=True) is None


def test_cast_float_string_to_integer_truncates():
    assert cast_value("3.9", INTEGER) == 3


def test_cast_boolean_to_string():
    assert cast_value(True, STRING) == "true"


def test_cast_string_to_date():
    assert cast_value("2024-05-06", DATE) == dt.date(2024, 5, 6)


def test_parse_timestamp_accepts_trailing_z():
    assert parse_timestamp("2024-05-06T01:02:03Z") is not None


def test_infer_column_type_widens_mixed_numbers():
    assert infer_column_type([1, 2.5]).kind is TypeKind.DOUBLE


def test_infer_column_type_of_all_nulls_is_string():
    assert infer_column_type([None, None]).kind is TypeKind.STRING


def test_infer_column_type_tracks_nullability():
    assert infer_column_type([1, None]).nullable
    assert not infer_column_type([1, 2]).nullable


def test_datatype_equality_is_structural():
    assert DataType(TypeKind.INTEGER, True) == INTEGER
    assert hash(DataType(TypeKind.INTEGER, True)) == hash(INTEGER)
