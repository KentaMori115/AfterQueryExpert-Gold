//! Column and relation schemas.

use std::fmt;

use crate::error::{Error, Result};
use crate::types::datatype::DataType;

/// A named, typed column in a schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    name: String,
    data_type: DataType,
    nullable: bool,
}

impl Field {
    /// A nullable field (the default for query outputs).
    pub fn new(name: impl Into<String>, data_type: DataType) -> Self {
        Field {
            name: name.into(),
            data_type,
            nullable: true,
        }
    }

    /// A field with an explicit nullability.
    pub fn with_nullability(name: impl Into<String>, data_type: DataType, nullable: bool) -> Self {
        Field {
            name: name.into(),
            data_type,
            nullable,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn data_type(&self) -> DataType {
        self.data_type
    }

    pub fn is_nullable(&self) -> bool {
        self.nullable
    }

    /// Return a copy of this field renamed (used when a projection aliases a
    /// column). The type and nullability are preserved.
    pub fn renamed(&self, name: impl Into<String>) -> Field {
        Field {
            name: name.into(),
            data_type: self.data_type,
            nullable: self.nullable,
        }
    }
}

impl fmt::Display for Field {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.name, self.data_type)?;
        if !self.nullable {
            f.write_str(" NOT NULL")?;
        }
        Ok(())
    }
}

/// An ordered collection of [`Field`]s describing a relation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Schema {
    fields: Vec<Field>,
}

impl Schema {
    /// Build a schema from fields, rejecting duplicate (case-insensitive) names.
    pub fn new(fields: Vec<Field>) -> Result<Schema> {
        let mut seen = Vec::new();
        for f in &fields {
            let lower = f.name().to_ascii_lowercase();
            if seen.contains(&lower) {
                return Err(Error::catalog(format!(
                    "duplicate column name '{}'",
                    f.name()
                )));
            }
            seen.push(lower);
        }
        Ok(Schema { fields })
    }

    /// Build a schema without the duplicate check. Callers must guarantee names
    /// are unique; used on internal paths that already validated their inputs.
    pub fn new_unchecked(fields: Vec<Field>) -> Schema {
        Schema { fields }
    }

    /// The empty schema.
    pub fn empty() -> Schema {
        Schema { fields: Vec::new() }
    }

    pub fn fields(&self) -> &[Field] {
        &self.fields
    }

    pub fn len(&self) -> usize {
        self.fields.len()
    }

    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    pub fn field(&self, index: usize) -> Option<&Field> {
        self.fields.get(index)
    }

    /// The declared type of a column by position.
    pub fn type_at(&self, index: usize) -> Option<DataType> {
        self.fields.get(index).map(Field::data_type)
    }

    /// Resolve a column name to its ordinal position (case-insensitive).
    ///
    /// Returns an `Binder` error if the name is unknown, and a distinct
    /// `Binder` error if it is ambiguous (appears more than once).
    pub fn index_of(&self, name: &str) -> Result<usize> {
        let lower = name.to_ascii_lowercase();
        let mut found = None;
        for (i, f) in self.fields.iter().enumerate() {
            if f.name().to_ascii_lowercase() == lower {
                if found.is_some() {
                    return Err(Error::binder(format!("column '{}' is ambiguous", name)));
                }
                found = Some(i);
            }
        }
        found.ok_or_else(|| Error::binder(format!("unknown column '{}'", name)))
    }

    /// Whether a column with the given name exists (case-insensitive).
    pub fn has_column(&self, name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        self.fields
            .iter()
            .any(|f| f.name().to_ascii_lowercase() == lower)
    }

    /// Concatenate two schemas (used to build a join's output schema).
    pub fn concat(&self, other: &Schema) -> Schema {
        let mut fields = self.fields.clone();
        fields.extend(other.fields.iter().cloned());
        Schema { fields }
    }

    /// Project a subset of columns by position, in the given order.
    pub fn project(&self, indices: &[usize]) -> Result<Schema> {
        let mut fields = Vec::with_capacity(indices.len());
        for &i in indices {
            let f = self
                .fields
                .get(i)
                .ok_or_else(|| Error::binder(format!("projection index {} out of range", i)))?;
            fields.push(f.clone());
        }
        Ok(Schema { fields })
    }
}

impl fmt::Display for Schema {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("(")?;
        for (i, field) in self.fields.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            write!(f, "{}", field)?;
        }
        f.write_str(")")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Schema {
        Schema::new(vec![
            Field::new("id", DataType::Integer),
            Field::new("name", DataType::Text),
            Field::new("score", DataType::Float),
        ])
        .unwrap()
    }

    #[test]
    fn rejects_duplicate_columns() {
        let err = Schema::new(vec![
            Field::new("a", DataType::Integer),
            Field::new("A", DataType::Text),
        ])
        .unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Catalog);
    }

    #[test]
    fn resolves_names_case_insensitively() {
        let s = schema();
        assert_eq!(s.index_of("NAME").unwrap(), 1);
        assert_eq!(s.index_of("score").unwrap(), 2);
        assert!(s.index_of("missing").is_err());
    }

    #[test]
    fn concat_appends_fields() {
        let s = schema().concat(&schema());
        assert_eq!(s.len(), 6);
    }

    #[test]
    fn project_reorders() {
        let s = schema().project(&[2, 0]).unwrap();
        assert_eq!(s.field(0).unwrap().name(), "score");
        assert_eq!(s.field(1).unwrap().name(), "id");
    }

    #[test]
    fn display_is_readable() {
        let s = Schema::new(vec![Field::with_nullability(
            "id",
            DataType::Integer,
            false,
        )])
        .unwrap();
        assert_eq!(s.to_string(), "(id INTEGER NOT NULL)");
    }
}
