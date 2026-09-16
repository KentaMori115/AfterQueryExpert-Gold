//! Logical data types understood by the engine.

use std::fmt;

/// A logical column/value type.
///
/// The engine has a deliberately small type lattice. `Null` is the type of the
/// untyped SQL `NULL` literal; it is coercible to any other type. Numeric types
/// (`Integer`, `Float`) form a promotion chain: an `Integer` promotes to
/// `Float` when the two meet in an arithmetic or comparison context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DataType {
    /// The type of a bare `NULL` before it is bound to a column.
    Null,
    /// 64-bit signed integer.
    Integer,
    /// 64-bit IEEE-754 floating point.
    Float,
    /// UTF-8 text.
    Text,
    /// Boolean.
    Boolean,
}

impl DataType {
    /// The canonical upper-case SQL name for this type.
    pub fn sql_name(self) -> &'static str {
        match self {
            DataType::Null => "NULL",
            DataType::Integer => "INTEGER",
            DataType::Float => "FLOAT",
            DataType::Text => "TEXT",
            DataType::Boolean => "BOOLEAN",
        }
    }

    /// Whether this type is one of the numeric types.
    pub fn is_numeric(self) -> bool {
        matches!(self, DataType::Integer | DataType::Float)
    }

    /// The result type of an arithmetic operation between `self` and `other`,
    /// or `None` if the two are not arithmetically compatible.
    ///
    /// `Null` propagates: any operation involving `Null` is typed `Null`.
    /// `Integer` op `Integer` stays `Integer`; if either side is `Float`, the
    /// result is `Float`.
    pub fn arithmetic_result(self, other: DataType) -> Option<DataType> {
        match (self, other) {
            (DataType::Null, _) | (_, DataType::Null) => Some(DataType::Null),
            (DataType::Integer, DataType::Integer) => Some(DataType::Integer),
            (a, b) if a.is_numeric() && b.is_numeric() => Some(DataType::Float),
            _ => None,
        }
    }

    /// The nearest common type both `self` and `other` can be widened to, used
    /// when unifying the arms of a `CASE` or the columns of a set operation.
    ///
    /// Returns `None` when there is no lossless widening (e.g. `Text` and
    /// `Integer`). `Null` unifies with anything, yielding the other type.
    pub fn unify(self, other: DataType) -> Option<DataType> {
        match (self, other) {
            (a, b) if a == b => Some(a),
            (DataType::Null, b) => Some(b),
            (a, DataType::Null) => Some(a),
            (a, b) if a.is_numeric() && b.is_numeric() => Some(DataType::Float),
            _ => None,
        }
    }

    /// Whether a value of `self` may be compared (`<`, `=`, ...) with a value of
    /// `other`. Comparison is allowed within the numeric family and between
    /// equal types; `Null` is comparable with everything (the comparison yields
    /// `NULL`).
    pub fn comparable_with(self, other: DataType) -> bool {
        match (self, other) {
            (DataType::Null, _) | (_, DataType::Null) => true,
            (a, b) if a == b => true,
            (a, b) if a.is_numeric() && b.is_numeric() => true,
            _ => false,
        }
    }
}

impl fmt::Display for DataType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.sql_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_classification() {
        assert!(DataType::Integer.is_numeric());
        assert!(DataType::Float.is_numeric());
        assert!(!DataType::Text.is_numeric());
        assert!(!DataType::Boolean.is_numeric());
        assert!(!DataType::Null.is_numeric());
    }

    #[test]
    fn arithmetic_promotes_to_float() {
        assert_eq!(
            DataType::Integer.arithmetic_result(DataType::Integer),
            Some(DataType::Integer)
        );
        assert_eq!(
            DataType::Integer.arithmetic_result(DataType::Float),
            Some(DataType::Float)
        );
        assert_eq!(
            DataType::Float.arithmetic_result(DataType::Float),
            Some(DataType::Float)
        );
        assert_eq!(DataType::Text.arithmetic_result(DataType::Integer), None);
    }

    #[test]
    fn arithmetic_with_null_is_null() {
        assert_eq!(
            DataType::Null.arithmetic_result(DataType::Integer),
            Some(DataType::Null)
        );
        assert_eq!(
            DataType::Float.arithmetic_result(DataType::Null),
            Some(DataType::Null)
        );
    }

    #[test]
    fn unify_widens_numeric() {
        assert_eq!(
            DataType::Integer.unify(DataType::Float),
            Some(DataType::Float)
        );
        assert_eq!(DataType::Text.unify(DataType::Text), Some(DataType::Text));
        assert_eq!(
            DataType::Null.unify(DataType::Boolean),
            Some(DataType::Boolean)
        );
        assert_eq!(DataType::Text.unify(DataType::Integer), None);
    }

    #[test]
    fn comparability() {
        assert!(DataType::Integer.comparable_with(DataType::Float));
        assert!(DataType::Text.comparable_with(DataType::Text));
        assert!(DataType::Null.comparable_with(DataType::Text));
        assert!(!DataType::Text.comparable_with(DataType::Integer));
        assert!(!DataType::Boolean.comparable_with(DataType::Integer));
    }

    #[test]
    fn sql_names() {
        assert_eq!(DataType::Integer.sql_name(), "INTEGER");
        assert_eq!(DataType::Boolean.to_string(), "BOOLEAN");
    }
}
