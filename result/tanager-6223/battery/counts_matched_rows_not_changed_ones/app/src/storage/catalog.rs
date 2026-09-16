//! The catalog: a namespace of tables keyed by case-insensitive name.

use std::collections::BTreeMap;

use crate::error::{Error, Result};
use crate::storage::table::Table;
use crate::types::Schema;

/// An in-memory namespace of [`Table`]s.
///
/// Names are matched case-insensitively but the original spelling is preserved
/// for display. A [`BTreeMap`] backs the store so [`Catalog::table_names`]
/// returns names in a deterministic (sorted) order — important for reproducible
/// output in tests and golden files.
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    tables: BTreeMap<String, Table>,
}

impl Catalog {
    /// An empty catalog.
    pub fn new() -> Catalog {
        Catalog {
            tables: BTreeMap::new(),
        }
    }

    fn key(name: &str) -> String {
        name.to_ascii_lowercase()
    }

    /// Number of tables.
    pub fn len(&self) -> usize {
        self.tables.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
    }

    /// Whether a table with `name` exists.
    pub fn contains(&self, name: &str) -> bool {
        self.tables.contains_key(&Self::key(name))
    }

    /// Create an empty table with the given schema. Errors if a table of that
    /// name already exists.
    pub fn create_table(&mut self, name: impl Into<String>, schema: Schema) -> Result<()> {
        let name = name.into();
        let key = Self::key(&name);
        if self.tables.contains_key(&key) {
            return Err(Error::catalog(format!("table '{}' already exists", name)));
        }
        self.tables.insert(key, Table::new(name, schema));
        Ok(())
    }

    /// Insert a fully-built table, replacing any existing table of that name.
    pub fn put_table(&mut self, table: Table) {
        self.tables.insert(Self::key(table.name()), table);
    }

    /// Borrow a table by name, erroring if it does not exist.
    pub fn table(&self, name: &str) -> Result<&Table> {
        self.tables
            .get(&Self::key(name))
            .ok_or_else(|| Error::catalog(format!("unknown table '{}'", name)))
    }

    /// Mutably borrow a table by name, erroring if it does not exist.
    pub fn table_mut(&mut self, name: &str) -> Result<&mut Table> {
        let key = Self::key(name);
        self.tables
            .get_mut(&key)
            .ok_or_else(|| Error::catalog(format!("unknown table '{}'", name)))
    }

    /// Look up a table's schema without borrowing the whole table.
    pub fn schema_of(&self, name: &str) -> Result<Schema> {
        self.table(name).map(|t| t.schema().clone())
    }

    /// Drop a table, erroring if it does not exist.
    pub fn drop_table(&mut self, name: &str) -> Result<()> {
        self.tables
            .remove(&Self::key(name))
            .map(|_| ())
            .ok_or_else(|| Error::catalog(format!("unknown table '{}'", name)))
    }

    /// All table names in deterministic (case-insensitive sorted) order, using
    /// each table's original spelling.
    pub fn table_names(&self) -> Vec<String> {
        self.tables.values().map(|t| t.name().to_string()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DataType, Field};

    fn schema() -> Schema {
        Schema::new(vec![Field::new("id", DataType::Integer)]).unwrap()
    }

    #[test]
    fn create_and_lookup_case_insensitive() {
        let mut c = Catalog::new();
        c.create_table("Users", schema()).unwrap();
        assert!(c.contains("users"));
        assert_eq!(c.table("USERS").unwrap().name(), "Users");
    }

    #[test]
    fn duplicate_create_errors() {
        let mut c = Catalog::new();
        c.create_table("t", schema()).unwrap();
        let err = c.create_table("T", schema()).unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Catalog);
    }

    #[test]
    fn drop_removes() {
        let mut c = Catalog::new();
        c.create_table("t", schema()).unwrap();
        c.drop_table("t").unwrap();
        assert!(!c.contains("t"));
        assert!(c.drop_table("t").is_err());
    }

    #[test]
    fn names_are_sorted() {
        let mut c = Catalog::new();
        c.create_table("beta", schema()).unwrap();
        c.create_table("alpha", schema()).unwrap();
        assert_eq!(c.table_names(), vec!["alpha", "beta"]);
    }
}
