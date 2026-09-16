//! Runtime values and their semantics (comparison, arithmetic, casting).
//!
//! The engine models SQL `NULL` with three-valued logic. Comparisons return
//! `Option<bool>` where `None` means the comparison evaluated to `NULL`.
//! Arithmetic propagates `NULL` and treats division (or modulo) by zero as an
//! [`ErrorKind::Execution`](crate::error::ErrorKind::Execution) error rather
//! than producing an infinity or `NaN`, keeping results deterministic.

use std::cmp::Ordering;
use std::fmt;

use crate::error::{Error, Result};
use crate::types::datatype::DataType;

/// A single runtime value.
#[derive(Debug, Clone)]
pub enum Value {
    /// SQL `NULL`.
    Null,
    /// 64-bit signed integer.
    Integer(i64),
    /// 64-bit float. Never `NaN` or infinite once produced by the engine.
    Float(f64),
    /// UTF-8 text.
    Text(String),
    /// Boolean.
    Boolean(bool),
}

impl Value {
    /// Construct a text value from anything string-like.
    pub fn text(s: impl Into<String>) -> Value {
        Value::Text(s.into())
    }

    /// The [`DataType`] of this value.
    pub fn data_type(&self) -> DataType {
        match self {
            Value::Null => DataType::Null,
            Value::Integer(_) => DataType::Integer,
            Value::Float(_) => DataType::Float,
            Value::Text(_) => DataType::Text,
            Value::Boolean(_) => DataType::Boolean,
        }
    }

    /// Whether this value is `NULL`.
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    // ------------------------------------------------------------------
    // Typed accessors. Each returns an `Api` error if the value is not of
    // the requested type (NULL included), so callers that have already
    // type-checked can unwrap meaning, not panics.
    // ------------------------------------------------------------------

    pub fn as_i64(&self) -> Result<i64> {
        match self {
            Value::Integer(i) => Ok(*i),
            _ => Err(Error::type_error(format!(
                "expected INTEGER, found {}",
                self.data_type()
            ))),
        }
    }

    pub fn as_f64(&self) -> Result<f64> {
        match self {
            Value::Integer(i) => Ok(*i as f64),
            Value::Float(f) => Ok(*f),
            _ => Err(Error::type_error(format!(
                "expected numeric, found {}",
                self.data_type()
            ))),
        }
    }

    pub fn as_str(&self) -> Result<&str> {
        match self {
            Value::Text(s) => Ok(s.as_str()),
            _ => Err(Error::type_error(format!(
                "expected TEXT, found {}",
                self.data_type()
            ))),
        }
    }

    pub fn as_bool(&self) -> Result<bool> {
        match self {
            Value::Boolean(b) => Ok(*b),
            _ => Err(Error::type_error(format!(
                "expected BOOLEAN, found {}",
                self.data_type()
            ))),
        }
    }

    /// Truthiness in a predicate context (`WHERE`, `HAVING`, `AND`/`OR`).
    ///
    /// A row is retained only when its predicate is exactly `TRUE`. `NULL` and
    /// `FALSE` are both non-retaining, so this collapses the three-valued
    /// result to a two-valued keep/drop decision.
    pub fn is_truthy(&self) -> bool {
        matches!(self, Value::Boolean(true))
    }

    // ------------------------------------------------------------------
    // Three-valued comparison
    // ------------------------------------------------------------------

    /// Compare two values under SQL semantics.
    ///
    /// Returns `Ok(None)` when either operand is `NULL` (the comparison is
    /// `NULL`), `Ok(Some(order))` otherwise, and an error when the two types
    /// are not comparable.
    pub fn compare(&self, other: &Value) -> Result<Option<Ordering>> {
        if self.is_null() || other.is_null() {
            return Ok(None);
        }
        let order = match (self, other) {
            (Value::Integer(a), Value::Integer(b)) => a.cmp(b),
            (Value::Boolean(a), Value::Boolean(b)) => a.cmp(b),
            (Value::Text(a), Value::Text(b)) => a.cmp(b),
            // Numeric cross-type comparison widens to float.
            (a, b) if a.data_type().is_numeric() && b.data_type().is_numeric() => {
                let (x, y) = (a.as_f64()?, b.as_f64()?);
                x.partial_cmp(&y).unwrap_or(Ordering::Equal)
            }
            _ => {
                return Err(Error::type_error(format!(
                    "cannot compare {} with {}",
                    self.data_type(),
                    other.data_type()
                )))
            }
        };
        Ok(Some(order))
    }

    /// Three-valued equality: `None` when either side is `NULL`.
    pub fn logical_eq(&self, other: &Value) -> Result<Option<bool>> {
        Ok(self.compare(other)?.map(|o| o == Ordering::Equal))
    }

    /// A *total* ordering used by `ORDER BY` and by grouping. Unlike
    /// [`compare`](Value::compare) this never returns `NULL`: `NULL` sorts
    /// before every non-null value when `nulls_first` is true and after every
    /// non-null value otherwise. Values of different (non-null) types are
    /// ordered by a stable type rank so the sort is always well-defined.
    pub fn sort_cmp(&self, other: &Value, nulls_first: bool) -> Ordering {
        match (self, other) {
            (Value::Null, Value::Null) => Ordering::Equal,
            (Value::Null, _) => {
                if nulls_first {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            }
            (_, Value::Null) => {
                if nulls_first {
                    Ordering::Greater
                } else {
                    Ordering::Less
                }
            }
            (Value::Integer(a), Value::Integer(b)) => a.cmp(b),
            (Value::Boolean(a), Value::Boolean(b)) => a.cmp(b),
            (Value::Text(a), Value::Text(b)) => a.cmp(b),
            (a, b) if a.data_type().is_numeric() && b.data_type().is_numeric() => {
                // Safe: both numeric, as_f64 cannot fail here.
                let (x, y) = (a.as_f64().unwrap(), b.as_f64().unwrap());
                x.total_cmp(&y)
            }
            (a, b) => type_rank(a).cmp(&type_rank(b)),
        }
    }

    /// A hashable, `Eq` key for grouping (`GROUP BY`, `DISTINCT`). `NULL` groups
    /// with `NULL`; floats hash by their bit pattern so `-0.0` and `0.0` fall in
    /// the same group.
    pub fn group_key(&self) -> GroupKey {
        match self {
            Value::Null => GroupKey::Null,
            Value::Integer(i) => GroupKey::Integer(*i),
            Value::Float(f) => GroupKey::Float(canonical_float_bits(*f)),
            Value::Text(s) => GroupKey::Text(s.clone()),
            Value::Boolean(b) => GroupKey::Boolean(*b),
        }
    }

    // ------------------------------------------------------------------
    // Arithmetic. All operators propagate NULL and widen INTEGER to FLOAT
    // when either operand is a float.
    // ------------------------------------------------------------------

    pub fn add(&self, other: &Value) -> Result<Value> {
        self.arith(other, "+", |a, b| Ok(a.wrapping_add(b)), |a, b| Ok(a + b))
    }

    pub fn sub(&self, other: &Value) -> Result<Value> {
        self.arith(other, "-", |a, b| Ok(a.wrapping_sub(b)), |a, b| Ok(a - b))
    }

    pub fn mul(&self, other: &Value) -> Result<Value> {
        self.arith(other, "*", |a, b| Ok(a.wrapping_mul(b)), |a, b| Ok(a * b))
    }

    pub fn div(&self, other: &Value) -> Result<Value> {
        self.arith(
            other,
            "/",
            |a, b| {
                if b == 0 {
                    Err(Error::execution("division by zero"))
                } else {
                    Ok(a.wrapping_div(b))
                }
            },
            |a, b| {
                if b == 0.0 {
                    Err(Error::execution("division by zero"))
                } else {
                    Ok(a / b)
                }
            },
        )
    }

    pub fn rem(&self, other: &Value) -> Result<Value> {
        self.arith(
            other,
            "%",
            |a, b| {
                if b == 0 {
                    Err(Error::execution("modulo by zero"))
                } else {
                    Ok(a.wrapping_rem(b))
                }
            },
            |a, b| {
                if b == 0.0 {
                    Err(Error::execution("modulo by zero"))
                } else {
                    Ok(a % b)
                }
            },
        )
    }

    /// Unary arithmetic negation. `NULL` stays `NULL`.
    pub fn neg(&self) -> Result<Value> {
        match self {
            Value::Null => Ok(Value::Null),
            Value::Integer(i) => Ok(Value::Integer(i.wrapping_neg())),
            Value::Float(f) => Ok(Value::Float(-f)),
            _ => Err(Error::type_error(format!(
                "cannot negate {}",
                self.data_type()
            ))),
        }
    }

    /// Shared arithmetic dispatch used by the four binary operators.
    fn arith(
        &self,
        other: &Value,
        symbol: &str,
        int_op: impl Fn(i64, i64) -> Result<i64>,
        float_op: impl Fn(f64, f64) -> Result<f64>,
    ) -> Result<Value> {
        if self.is_null() || other.is_null() {
            return Ok(Value::Null);
        }
        match (self, other) {
            (Value::Integer(a), Value::Integer(b)) => Ok(Value::Integer(int_op(*a, *b)?)),
            (a, b) if a.data_type().is_numeric() && b.data_type().is_numeric() => {
                Ok(Value::Float(float_op(a.as_f64()?, b.as_f64()?)?))
            }
            _ => Err(Error::type_error(format!(
                "cannot apply '{}' to {} and {}",
                symbol,
                self.data_type(),
                other.data_type()
            ))),
        }
    }

    // ------------------------------------------------------------------
    // Casting
    // ------------------------------------------------------------------

    /// Cast this value to `target`. `NULL` casts to `NULL` of any type. Text
    /// parses into numbers/booleans; numbers render into text; booleans map to
    /// `0`/`1` when cast to a number.
    pub fn cast(&self, target: DataType) -> Result<Value> {
        if self.is_null() {
            return Ok(Value::Null);
        }
        match (self, target) {
            (_, DataType::Null) => Ok(Value::Null),
            (v, t) if v.data_type() == t => Ok(v.clone()),

            (Value::Integer(i), DataType::Float) => Ok(Value::Float(*i as f64)),
            (Value::Integer(i), DataType::Text) => Ok(Value::text(i.to_string())),
            (Value::Integer(i), DataType::Boolean) => Ok(Value::Boolean(*i != 0)),

            (Value::Float(f), DataType::Integer) => Ok(Value::Integer(f.trunc() as i64)),
            (Value::Float(f), DataType::Text) => Ok(Value::text(format_float(*f))),

            (Value::Boolean(b), DataType::Integer) => Ok(Value::Integer(i64::from(*b))),
            (Value::Boolean(b), DataType::Text) => {
                Ok(Value::text(if *b { "true" } else { "false" }))
            }

            (Value::Text(s), DataType::Integer) => s
                .trim()
                .parse::<i64>()
                .map(Value::Integer)
                .map_err(|_| Error::execution(format!("cannot cast '{}' to INTEGER", s))),
            (Value::Text(s), DataType::Float) => s
                .trim()
                .parse::<f64>()
                .map(Value::Float)
                .map_err(|_| Error::execution(format!("cannot cast '{}' to FLOAT", s))),
            (Value::Text(s), DataType::Boolean) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "t" | "1" => Ok(Value::Boolean(true)),
                "false" | "f" | "0" => Ok(Value::Boolean(false)),
                _ => Err(Error::execution(format!("cannot cast '{}' to BOOLEAN", s))),
            },

            (v, t) => Err(Error::type_error(format!(
                "cannot cast {} to {}",
                v.data_type(),
                t
            ))),
        }
    }
}

/// A hashable projection of a [`Value`] used as a grouping key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum GroupKey {
    Null,
    Integer(i64),
    /// Canonicalized float bits (see [`canonical_float_bits`]).
    Float(u64),
    Text(String),
    Boolean(bool),
}

/// Canonicalize a float's bits so that `0.0` and `-0.0` share a key and all
/// `NaN`s collapse to a single bit pattern.
fn canonical_float_bits(f: f64) -> u64 {
    if f == 0.0 {
        0.0f64.to_bits()
    } else if f.is_nan() {
        f64::NAN.to_bits()
    } else {
        f.to_bits()
    }
}

/// Stable per-variant rank so cross-type `ORDER BY` is deterministic.
fn type_rank(v: &Value) -> u8 {
    match v {
        Value::Null => 0,
        Value::Boolean(_) => 1,
        Value::Integer(_) | Value::Float(_) => 2,
        Value::Text(_) => 3,
    }
}

/// Render a float the way the engine prints and text-casts it: integral floats
/// keep a trailing `.0` so their type stays visible.
pub fn format_float(f: f64) -> String {
    if f == f.trunc() && f.is_finite() {
        format!("{:.1}", f)
    } else {
        format!("{}", f)
    }
}

/// Structural equality for storage and tests — *not* SQL equality.
///
/// Unlike [`Value::logical_eq`], this treats `NULL == NULL` as `true`, never
/// returns `NULL`, and compares floats by their bit pattern so it is reflexive
/// even for `NaN`. SQL three-valued equality lives in [`Value::compare`] /
/// [`Value::logical_eq`]; this impl exists so rows and columns can be compared
/// for identity (deduplication, golden-output assertions).
impl PartialEq for Value {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Integer(a), Value::Integer(b)) => a == b,
            (Value::Float(a), Value::Float(b)) => a.to_bits() == b.to_bits(),
            (Value::Text(a), Value::Text(b)) => a == b,
            (Value::Boolean(a), Value::Boolean(b)) => a == b,
            _ => false,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => f.write_str("NULL"),
            Value::Integer(i) => write!(f, "{}", i),
            Value::Float(x) => f.write_str(&format_float(*x)),
            Value::Text(s) => f.write_str(s),
            Value::Boolean(b) => f.write_str(if *b { "true" } else { "false" }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_propagates_through_arithmetic() {
        assert!(Value::Null.add(&Value::Integer(3)).unwrap().is_null());
        assert!(Value::Integer(3).mul(&Value::Null).unwrap().is_null());
    }

    #[test]
    fn integer_arithmetic_stays_integer() {
        assert!(matches!(
            Value::Integer(6).add(&Value::Integer(4)).unwrap(),
            Value::Integer(10)
        ));
    }

    #[test]
    fn mixed_arithmetic_widens_to_float() {
        match Value::Integer(3).add(&Value::Float(0.5)).unwrap() {
            Value::Float(f) => assert_eq!(f, 3.5),
            other => panic!("expected float, got {:?}", other),
        }
    }

    #[test]
    fn division_by_zero_is_execution_error() {
        let err = Value::Integer(1).div(&Value::Integer(0)).unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Execution);
        let err = Value::Float(1.0).div(&Value::Float(0.0)).unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Execution);
    }

    #[test]
    fn comparison_is_three_valued() {
        assert_eq!(
            Value::Integer(1).logical_eq(&Value::Integer(1)).unwrap(),
            Some(true)
        );
        assert_eq!(Value::Integer(1).logical_eq(&Value::Null).unwrap(), None);
    }

    #[test]
    fn sort_puts_nulls_first_or_last() {
        assert_eq!(
            Value::Null.sort_cmp(&Value::Integer(1), true),
            Ordering::Less
        );
        assert_eq!(
            Value::Null.sort_cmp(&Value::Integer(1), false),
            Ordering::Greater
        );
    }

    #[test]
    fn group_key_merges_signed_zero() {
        assert_eq!(
            Value::Float(0.0).group_key(),
            Value::Float(-0.0).group_key()
        );
    }

    #[test]
    fn cast_text_to_integer() {
        assert!(matches!(
            Value::text(" 42 ").cast(DataType::Integer).unwrap(),
            Value::Integer(42)
        ));
        assert!(Value::text("nope").cast(DataType::Integer).is_err());
    }

    #[test]
    fn float_formats_keep_type_visible() {
        assert_eq!(format_float(3.0), "3.0");
        assert_eq!(Value::Float(2.5).to_string(), "2.5");
    }

    #[test]
    fn truthiness_collapses_null_to_false() {
        assert!(Value::Boolean(true).is_truthy());
        assert!(!Value::Boolean(false).is_truthy());
        assert!(!Value::Null.is_truthy());
    }
}
