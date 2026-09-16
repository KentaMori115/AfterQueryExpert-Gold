//! Name resolution: mapping column references to positional indices.

use crate::ast::expr::ColumnRef;
use crate::error::{Error, Result};
use crate::types::{DataType, Schema};

/// One resolvable column in a scope.
#[derive(Debug, Clone)]
struct Binding {
    /// The relation qualifier (table name or alias). `None` for a scope built
    /// from an output schema (e.g. resolving `ORDER BY`).
    qualifier: Option<String>,
    name: String,
    index: usize,
    data_type: DataType,
}

/// A flat namespace of columns available to expression binding, in row order.
#[derive(Debug, Clone, Default)]
pub struct Scope {
    bindings: Vec<Binding>,
}

impl Scope {
    /// An empty scope (no columns) — used for constant `SELECT`s and `INSERT`
    /// value expressions.
    pub fn empty() -> Scope {
        Scope {
            bindings: Vec::new(),
        }
    }

    /// Build a scope for a base relation whose columns start at `start_index`
    /// in the combined row, qualified by `qualifier`.
    pub fn from_table(qualifier: &str, schema: &Schema, start_index: usize) -> Scope {
        let bindings = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| Binding {
                qualifier: Some(qualifier.to_string()),
                name: f.name().to_string(),
                index: start_index + i,
                data_type: f.data_type(),
            })
            .collect();
        Scope { bindings }
    }

    /// Build an unqualified scope from an output schema, for resolving
    /// `ORDER BY` keys against result columns.
    pub fn from_output(schema: &Schema) -> Scope {
        let bindings = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| Binding {
                qualifier: None,
                name: f.name().to_string(),
                index: i,
                data_type: f.data_type(),
            })
            .collect();
        Scope { bindings }
    }

    /// The number of columns in scope.
    pub fn len(&self) -> usize {
        self.bindings.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bindings.is_empty()
    }

    /// Concatenate two scopes (left columns then right), as a join produces.
    pub fn concat(&self, other: &Scope) -> Scope {
        let mut bindings = self.bindings.clone();
        bindings.extend(other.bindings.iter().cloned());
        Scope { bindings }
    }

    /// Resolve a column reference to its `(index, type)`.
    ///
    /// A qualified reference (`t.c`) matches only bindings with that qualifier.
    /// An unqualified reference matches by name across all bindings and errors
    /// if the name is ambiguous.
    pub fn resolve(&self, column: &ColumnRef) -> Result<(usize, DataType)> {
        let name_lower = column.name.to_ascii_lowercase();
        let mut matches = self.bindings.iter().filter(|b| {
            b.name.to_ascii_lowercase() == name_lower
                && match &column.qualifier {
                    Some(q) => b
                        .qualifier
                        .as_ref()
                        .map(|bq| bq.eq_ignore_ascii_case(q))
                        .unwrap_or(false),
                    None => true,
                }
        });
        let first = matches
            .next()
            .ok_or_else(|| Error::binder(format!("unknown column '{}'", column.display_name())))?;
        if matches.next().is_some() {
            return Err(Error::binder(format!(
                "column reference '{}' is ambiguous",
                column.display_name()
            )));
        }
        Ok((first.index, first.data_type))
    }

    /// All `(index, name, type)` triples, in row order — used to expand `*`.
    pub fn columns(&self) -> Vec<(usize, String, DataType)> {
        self.bindings
            .iter()
            .map(|b| (b.index, b.name.clone(), b.data_type))
            .collect()
    }

    /// The columns belonging to a given qualifier, in row order — used to
    /// expand `t.*`.
    pub fn columns_for(&self, qualifier: &str) -> Result<Vec<(usize, String, DataType)>> {
        let cols: Vec<_> = self
            .bindings
            .iter()
            .filter(|b| {
                b.qualifier
                    .as_ref()
                    .map(|q| q.eq_ignore_ascii_case(qualifier))
                    .unwrap_or(false)
            })
            .map(|b| (b.index, b.name.clone(), b.data_type))
            .collect();
        if cols.is_empty() {
            return Err(Error::binder(format!(
                "unknown table qualifier '{}'",
                qualifier
            )));
        }
        Ok(cols)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Field;

    fn schema() -> Schema {
        Schema::new(vec![
            Field::new("id", DataType::Integer),
            Field::new("name", DataType::Text),
        ])
        .unwrap()
    }

    #[test]
    fn resolves_qualified_and_unqualified() {
        let scope = Scope::from_table("t", &schema(), 0);
        assert_eq!(
            scope.resolve(&ColumnRef::unqualified("name")).unwrap(),
            (1, DataType::Text)
        );
        assert_eq!(
            scope.resolve(&ColumnRef::qualified("t", "id")).unwrap(),
            (0, DataType::Integer)
        );
        assert!(scope.resolve(&ColumnRef::qualified("u", "id")).is_err());
    }

    #[test]
    fn detects_ambiguity_across_joined_scopes() {
        let left = Scope::from_table("a", &schema(), 0);
        let right = Scope::from_table("b", &schema(), 2);
        let joined = left.concat(&right);
        // 'id' is ambiguous unqualified...
        assert!(joined.resolve(&ColumnRef::unqualified("id")).is_err());
        // ...but resolvable when qualified.
        assert_eq!(
            joined.resolve(&ColumnRef::qualified("b", "id")).unwrap(),
            (2, DataType::Integer)
        );
    }
}
