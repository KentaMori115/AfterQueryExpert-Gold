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
    /// Whether `*` expands to this binding. A column merged by `USING` keeps
    /// one visible binding and a hidden one per side, so that `a.id`, `b.id`
    /// and a bare `id` all reach the single merged column while `*` shows it
    /// once.
    visible: bool,
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
                visible: true,
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
                visible: true,
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
        // Several bindings may carry one name when a `USING` column was merged.
        // That is only ambiguous if they lead to different columns.
        if matches.any(|b| b.index != first.index) {
            return Err(Error::binder(format!(
                "column reference '{}' is ambiguous",
                column.display_name()
            )));
        }
        Ok((first.index, first.data_type))
    }

    /// All visible `(index, name, type)` triples, in row order — used to
    /// expand `*`. A column hidden behind a `USING` merge is skipped here and
    /// still resolves by name.
    pub fn columns(&self) -> Vec<(usize, String, DataType)> {
        self.bindings
            .iter()
            .filter(|b| b.visible)
            .map(|b| (b.index, b.name.clone(), b.data_type))
            .collect()
    }

    /// Every binding as `(qualifier, name, index, type, visible)`, in row
    /// order, including the ones `*` does not expand. The binder reads these
    /// when it rebuilds a scope over a join's output frame.
    pub fn entries(&self) -> Vec<(Option<String>, String, usize, DataType, bool)> {
        self.bindings
            .iter()
            .map(|b| {
                (
                    b.qualifier.clone(),
                    b.name.clone(),
                    b.index,
                    b.data_type,
                    b.visible,
                )
            })
            .collect()
    }

    /// Add one column to this scope at `index` in the current row frame.
    ///
    /// `visible` decides whether `*` expands to it; a qualified reference finds
    /// it either way.
    pub fn push_column(
        &mut self,
        qualifier: Option<&str>,
        name: &str,
        index: usize,
        data_type: DataType,
        visible: bool,
    ) {
        self.bindings.push(Binding {
            qualifier: qualifier.map(|q| q.to_string()),
            name: name.to_string(),
            index,
            data_type,
            visible,
        });
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
    fn merged_bindings_sharing_one_column_are_not_ambiguous() {
        let mut scope = Scope::empty();
        scope.push_column(None, "id", 0, DataType::Integer, true);
        scope.push_column(Some("a"), "id", 0, DataType::Integer, false);
        scope.push_column(Some("b"), "id", 0, DataType::Integer, false);
        scope.push_column(Some("a"), "name", 1, DataType::Text, true);
        assert_eq!(
            scope.resolve(&ColumnRef::unqualified("id")).unwrap(),
            (0, DataType::Integer)
        );
        assert_eq!(
            scope.resolve(&ColumnRef::qualified("b", "id")).unwrap(),
            (0, DataType::Integer)
        );
        // `*` shows the merged column once.
        let names: Vec<String> = scope.columns().into_iter().map(|c| c.1).collect();
        assert_eq!(names, vec!["id".to_string(), "name".to_string()]);
        // ...and `a.*` still reaches it.
        assert_eq!(scope.columns_for("a").unwrap().len(), 2);
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
