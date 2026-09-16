//! In-memory tables stored column-at-a-time.

use crate::error::{Error, Result};
use crate::storage::column::ColumnVector;
use crate::storage::row::Row;
use crate::types::{DataType, Field, Schema, Value};

/// An in-memory relation: a [`Schema`] plus one [`ColumnVector`] per field.
///
/// Rows are appended through [`Table::insert_row`], which validates arity,
/// types (with integer→float widening), and `NOT NULL` constraints. Reads are
/// row-oriented via [`Table::iter_rows`], which materializes a [`Row`] per
/// stored tuple.
#[derive(Debug, Clone, PartialEq)]
pub struct Table {
    name: String,
    schema: Schema,
    columns: Vec<ColumnVector>,
    row_count: usize,
}

impl Table {
    /// Create an empty table with the given name and schema.
    pub fn new(name: impl Into<String>, schema: Schema) -> Table {
        let columns = schema
            .fields()
            .iter()
            .map(|f| ColumnVector::new(f.data_type()))
            .collect();
        Table {
            name: name.into(),
            schema,
            columns,
            row_count: 0,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    /// The number of rows currently stored.
    pub fn row_count(&self) -> usize {
        self.row_count
    }

    pub fn is_empty(&self) -> bool {
        self.row_count == 0
    }

    /// The number of columns.
    pub fn width(&self) -> usize {
        self.columns.len()
    }

    /// Borrow a column by position.
    pub fn column(&self, index: usize) -> Option<&ColumnVector> {
        self.columns.get(index)
    }

    /// Insert one row, validating it against the schema.
    ///
    /// * arity must match the schema width,
    /// * each value must match its column type (an `INTEGER` supplied for a
    ///   `FLOAT` column is widened), and
    /// * a `NULL` supplied for a `NOT NULL` column is rejected.
    pub fn insert_row(&mut self, row: Row) -> Result<()> {
        // Coerce and validate every value before mutating any column so a
        // rejected row leaves the table unchanged.
        let coerced = self.coerce_row(row)?;
        for (column, value) in self.columns.iter_mut().zip(coerced.into_values()) {
            column.push_unchecked(value);
        }
        self.row_count += 1;
        Ok(())
    }

    /// Insert many rows, stopping at (and returning) the first invalid row. Rows
    /// already inserted before the failure remain.
    pub fn insert_rows(&mut self, rows: impl IntoIterator<Item = Row>) -> Result<usize> {
        let mut n = 0;
        for row in rows {
            self.insert_row(row)?;
            n += 1;
        }
        Ok(n)
    }

    /// Validate and widen `row` for storage in this table without writing it.
    ///
    /// Callers that must leave the table untouched when any row of a statement
    /// is bad — `UPDATE` is one — coerce every candidate row first and only
    /// then write.
    pub fn coerce_row(&self, row: Row) -> Result<Row> {
        let values = row.into_values();
        if values.len() != self.schema.len() {
            return Err(Error::api(format!(
                "table '{}' expects {} value(s) per row, got {}",
                self.name,
                self.schema.len(),
                values.len()
            )));
        }
        let mut coerced = Vec::with_capacity(values.len());
        for (value, field) in values.into_iter().zip(self.schema.fields()) {
            coerced.push(coerce_for_field(value, field)?);
        }
        Ok(Row::new(coerced))
    }

    /// Overwrite stored rows in place.
    ///
    /// Every row must already have been through [`Table::coerce_row`] for this
    /// table, which is what lets the write itself be infallible: by the time
    /// any column is touched, no later row can reject the statement.
    pub fn replace_rows(&mut self, rows: Vec<(usize, Row)>) -> Result<usize> {
        for (index, _) in &rows {
            if *index >= self.row_count {
                return Err(Error::api(format!(
                    "table '{}' has no row at position {}",
                    self.name, index
                )));
            }
        }
        let replaced = rows.len();
        for (index, row) in rows {
            for (column, value) in self.columns.iter_mut().zip(row.into_values()) {
                column.set_unchecked(index, value);
            }
        }
        Ok(replaced)
    }

    /// Remove every row whose flag in `remove` is `true`, keeping the survivors
    /// in their stored order. Returns how many rows went away.
    pub fn remove_rows(&mut self, remove: &[bool]) -> usize {
        let removed = remove.iter().take(self.row_count).filter(|d| **d).count();
        for column in self.columns.iter_mut() {
            column.remove_marked(remove);
        }
        self.row_count -= removed;
        removed
    }

    /// Materialize the row at `index`.
    pub fn row(&self, index: usize) -> Option<Row> {
        if index >= self.row_count {
            return None;
        }
        let values = self
            .columns
            .iter()
            .map(|c| c.get(index).cloned().unwrap_or(Value::Null))
            .collect();
        Some(Row::new(values))
    }

    /// Iterate over all rows, materializing each on demand.
    pub fn iter_rows(&self) -> RowIter<'_> {
        RowIter {
            table: self,
            pos: 0,
        }
    }

    /// Collect all rows into a vector (convenience for small results/tests).
    pub fn to_rows(&self) -> Vec<Row> {
        self.iter_rows().collect()
    }
}

/// Widen/validate `value` for storage in `field`'s column.
fn coerce_for_field(value: Value, field: &Field) -> Result<Value> {
    if value.is_null() {
        if !field.is_nullable() {
            return Err(Error::api(format!(
                "column '{}' is NOT NULL but a NULL was supplied",
                field.name()
            )));
        }
        return Ok(Value::Null);
    }
    match (value.data_type(), field.data_type()) {
        (a, b) if a == b => Ok(value),
        (DataType::Integer, DataType::Float) => Ok(Value::Float(value.as_i64()? as f64)),
        (_, _) => Ok(value),
    }
}

/// Iterator over a table's rows, produced by [`Table::iter_rows`].
pub struct RowIter<'a> {
    table: &'a Table,
    pos: usize,
}

impl<'a> Iterator for RowIter<'a> {
    type Item = Row;

    fn next(&mut self) -> Option<Row> {
        let row = self.table.row(self.pos)?;
        self.pos += 1;
        Some(row)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.table.row_count.saturating_sub(self.pos);
        (remaining, Some(remaining))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn people() -> Table {
        let schema = Schema::new(vec![
            Field::with_nullability("id", DataType::Integer, false),
            Field::new("name", DataType::Text),
            Field::new("score", DataType::Float),
        ])
        .unwrap();
        Table::new("people", schema)
    }

    #[test]
    fn insert_and_iterate() {
        let mut t = people();
        t.insert_row(Row::new(vec![
            Value::Integer(1),
            Value::text("ada"),
            Value::Float(9.5),
        ]))
        .unwrap();
        // integer widened into the FLOAT column
        t.insert_row(Row::new(vec![
            Value::Integer(2),
            Value::text("grace"),
            Value::Integer(8),
        ]))
        .unwrap();
        assert_eq!(t.row_count(), 2);
        let rows = t.to_rows();
        assert_eq!(rows[1].get(2), Some(&Value::Float(8.0)));
    }

    #[test]
    fn replace_rows_keeps_positions() {
        let mut t = people();
        t.insert_row(Row::new(vec![
            Value::Integer(1),
            Value::text("ada"),
            Value::Float(1.0),
        ]))
        .unwrap();
        t.insert_row(Row::new(vec![
            Value::Integer(2),
            Value::text("grace"),
            Value::Float(2.0),
        ]))
        .unwrap();
        let replacement = t
            .coerce_row(Row::new(vec![
                Value::Integer(2),
                Value::text("hopper"),
                Value::Integer(3),
            ]))
            .unwrap();
        assert_eq!(t.replace_rows(vec![(1, replacement)]).unwrap(), 1);
        let rows = t.to_rows();
        assert_eq!(rows[0].get(1), Some(&Value::text("ada")));
        assert_eq!(rows[1].get(1), Some(&Value::text("hopper")));
        assert_eq!(rows[1].get(2), Some(&Value::Float(3.0)));
    }

    #[test]
    fn remove_rows_compacts_every_column() {
        let mut t = people();
        for i in 0..4 {
            t.insert_row(Row::new(vec![
                Value::Integer(i),
                Value::text(format!("n{}", i)),
                Value::Float(i as f64),
            ]))
            .unwrap();
        }
        assert_eq!(t.remove_rows(&[false, true, true, false]), 2);
        assert_eq!(t.row_count(), 2);
        let rows = t.to_rows();
        assert_eq!(rows[0].get(0), Some(&Value::Integer(0)));
        assert_eq!(rows[1].get(0), Some(&Value::Integer(3)));
        assert_eq!(t.column(1).unwrap().len(), 2);
    }

    #[test]
    fn coerce_row_reports_a_not_null_violation() {
        let t = people();
        let err = t
            .coerce_row(Row::new(vec![Value::Null, Value::text("x"), Value::Null]))
            .unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Api);
        assert_eq!(t.row_count(), 0);
    }

    #[test]
    fn rejects_bad_arity() {
        let mut t = people();
        let err = t.insert_row(Row::new(vec![Value::Integer(1)])).unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Api);
        assert_eq!(t.row_count(), 0);
    }

    #[test]
    fn rejects_null_in_not_null_column() {
        let mut t = people();
        let err = t
            .insert_row(Row::new(vec![Value::Null, Value::text("x"), Value::Null]))
            .unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Api);
    }

    #[test]
    fn rejects_type_mismatch() {
        let mut t = people();
        let err = t
            .insert_row(Row::new(vec![
                Value::text("nope"),
                Value::text("x"),
                Value::Float(1.0),
            ]))
            .unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Type);
    }
}
