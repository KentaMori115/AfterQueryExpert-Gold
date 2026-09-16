//! A row: an ordered tuple of [`Value`]s aligned to a schema.

use std::fmt;

use crate::types::Value;

/// An ordered tuple of values. A `Row` carries no schema of its own; it is
/// always interpreted against the schema of the relation that produced it.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    values: Vec<Value>,
}

impl Row {
    /// Wrap a vector of values as a row.
    pub fn new(values: Vec<Value>) -> Row {
        Row { values }
    }

    /// An empty row (zero columns).
    pub fn empty() -> Row {
        Row { values: Vec::new() }
    }

    /// The number of columns.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Borrow the value at `index`, if present.
    pub fn get(&self, index: usize) -> Option<&Value> {
        self.values.get(index)
    }

    /// All values, in column order.
    pub fn values(&self) -> &[Value] {
        &self.values
    }

    /// Consume the row, yielding its values.
    pub fn into_values(self) -> Vec<Value> {
        self.values
    }

    /// Append the columns of `other` after this row's columns, producing the
    /// combined row used by joins.
    pub fn concat(&self, other: &Row) -> Row {
        let mut values = self.values.clone();
        values.extend(other.values.iter().cloned());
        Row { values }
    }

    /// Build a new row by selecting columns at the given positions, in order.
    /// Positions out of range contribute a `NULL`.
    pub fn select(&self, indices: &[usize]) -> Row {
        let values = indices
            .iter()
            .map(|&i| self.values.get(i).cloned().unwrap_or(Value::Null))
            .collect();
        Row { values }
    }
}

impl fmt::Display for Row {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("(")?;
        for (i, v) in self.values.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            write!(f, "{}", v)?;
        }
        f.write_str(")")
    }
}

impl From<Vec<Value>> for Row {
    fn from(values: Vec<Value>) -> Self {
        Row { values }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concat_joins_columns() {
        let a = Row::new(vec![Value::Integer(1), Value::text("x")]);
        let b = Row::new(vec![Value::Boolean(true)]);
        let c = a.concat(&b);
        assert_eq!(c.len(), 3);
        assert_eq!(c.get(2), Some(&Value::Boolean(true)));
    }

    #[test]
    fn select_reorders_and_pads() {
        let r = Row::new(vec![Value::Integer(10), Value::Integer(20)]);
        let s = r.select(&[1, 0, 5]);
        assert_eq!(s.get(0), Some(&Value::Integer(20)));
        assert_eq!(s.get(1), Some(&Value::Integer(10)));
        assert_eq!(s.get(2), Some(&Value::Null));
    }

    #[test]
    fn display_formats_tuple() {
        let r = Row::new(vec![Value::Integer(1), Value::Null, Value::text("hi")]);
        assert_eq!(r.to_string(), "(1, NULL, hi)");
    }
}
