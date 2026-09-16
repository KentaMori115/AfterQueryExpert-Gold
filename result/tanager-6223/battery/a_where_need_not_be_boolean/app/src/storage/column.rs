//! Columnar storage: a typed vector of values for one column.

use crate::error::{Error, Result};
use crate::types::{DataType, Value};

/// A single column's worth of values, all sharing one declared [`DataType`]
/// (or `NULL`). Storing data column-at-a-time is what makes scans and
/// column-oriented aggregation cache-friendly.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnVector {
    data_type: DataType,
    values: Vec<Value>,
}

impl ColumnVector {
    /// An empty column of the given declared type.
    pub fn new(data_type: DataType) -> ColumnVector {
        ColumnVector {
            data_type,
            values: Vec::new(),
        }
    }

    /// An empty column with capacity reserved for `cap` values.
    pub fn with_capacity(data_type: DataType, cap: usize) -> ColumnVector {
        ColumnVector {
            data_type,
            values: Vec::with_capacity(cap),
        }
    }

    /// The declared type of the column.
    pub fn data_type(&self) -> DataType {
        self.data_type
    }

    /// The number of values stored.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Borrow the value at `index`.
    pub fn get(&self, index: usize) -> Option<&Value> {
        self.values.get(index)
    }

    /// Append a value, checking that it is either `NULL` or matches the declared
    /// type. Integers are *not* silently widened to floats here; the caller is
    /// expected to have coerced already. Returns a `Type` error on mismatch.
    pub fn push(&mut self, value: Value) -> Result<()> {
        if !value.is_null() && value.data_type() != self.data_type {
            return Err(Error::type_error(format!(
                "column of type {} cannot hold value of type {}",
                self.data_type,
                value.data_type()
            )));
        }
        self.values.push(value);
        Ok(())
    }

    /// Append a value already known to match the column type (no validation).
    pub fn push_unchecked(&mut self, value: Value) {
        self.values.push(value);
    }

    /// Overwrite the value at `index` with one already known to match the
    /// column type. Out-of-range positions are ignored.
    pub fn set_unchecked(&mut self, index: usize, value: Value) {
        if let Some(slot) = self.values.get_mut(index) {
            *slot = value;
        }
    }

    /// Drop every value whose flag in `remove` is `true`, keeping the rest in
    /// their original order. Flags beyond the column's length are ignored, and
    /// a short `remove` keeps the trailing values.
    pub fn remove_marked(&mut self, remove: &[bool]) {
        let mut position = 0;
        self.values.retain(|_| {
            let drop = remove.get(position).copied().unwrap_or(false);
            position += 1;
            !drop
        });
    }

    /// Iterate over the stored values.
    pub fn iter(&self) -> impl Iterator<Item = &Value> {
        self.values.iter()
    }

    /// The number of `NULL`s in the column.
    pub fn null_count(&self) -> usize {
        self.values.iter().filter(|v| v.is_null()).count()
    }

    /// Collect the values at the given row positions into a new column of the
    /// same type (used when a filter/sort reorders or drops rows).
    pub fn take(&self, indices: &[usize]) -> ColumnVector {
        let mut out = ColumnVector::with_capacity(self.data_type, indices.len());
        for &i in indices {
            out.values
                .push(self.values.get(i).cloned().unwrap_or(Value::Null));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_type_checks() {
        let mut c = ColumnVector::new(DataType::Integer);
        assert!(c.push(Value::Integer(1)).is_ok());
        assert!(c.push(Value::Null).is_ok());
        assert!(c.push(Value::text("x")).is_err());
        assert_eq!(c.len(), 2);
        assert_eq!(c.null_count(), 1);
    }

    #[test]
    fn take_reorders() {
        let mut c = ColumnVector::new(DataType::Integer);
        for i in 0..3 {
            c.push(Value::Integer(i)).unwrap();
        }
        let t = c.take(&[2, 0]);
        assert_eq!(t.get(0), Some(&Value::Integer(2)));
        assert_eq!(t.get(1), Some(&Value::Integer(0)));
    }
}
