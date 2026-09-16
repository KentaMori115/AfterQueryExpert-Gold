//! The statement AST: the top-level nodes the parser produces.

use crate::ast::expr::Expr;
use crate::types::DataType;

/// A parsed top-level statement.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    Select(SelectStmt),
    Insert(InsertStmt),
    CreateTable(CreateTableStmt),
    DropTable(DropTableStmt),
    /// `EXPLAIN <select>` — return the optimized plan instead of executing it.
    Explain(SelectStmt),
}

/// One projection item in a `SELECT` list.
#[derive(Debug, Clone, PartialEq)]
pub enum SelectItem {
    /// `*`
    Wildcard,
    /// `t.*`
    QualifiedWildcard(String),
    /// An expression with an optional `AS alias`.
    Expr { expr: Expr, alias: Option<String> },
}

/// The kind of join.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinType {
    Inner,
    Left,
}

impl JoinType {
    pub fn keyword(self) -> &'static str {
        match self {
            JoinType::Inner => "INNER JOIN",
            JoinType::Left => "LEFT JOIN",
        }
    }
}

/// A joined relation and its `ON` predicate.
#[derive(Debug, Clone, PartialEq)]
pub struct Join {
    pub join_type: JoinType,
    pub relation: TableFactor,
    pub on: Expr,
}

/// A base relation in a `FROM` clause: a named table with an optional alias.
#[derive(Debug, Clone, PartialEq)]
pub struct TableFactor {
    pub name: String,
    pub alias: Option<String>,
}

impl TableFactor {
    /// The name by which columns of this relation are qualified: the alias if
    /// present, otherwise the table name.
    pub fn binding_name(&self) -> &str {
        self.alias.as_deref().unwrap_or(&self.name)
    }
}

/// A `FROM` clause: a base relation plus zero or more joins.
#[derive(Debug, Clone, PartialEq)]
pub struct FromClause {
    pub base: TableFactor,
    pub joins: Vec<Join>,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Asc,
    Desc,
}

/// One `ORDER BY` key.
#[derive(Debug, Clone, PartialEq)]
pub struct OrderByExpr {
    pub expr: Expr,
    pub direction: SortDirection,
    /// `true` to sort `NULL`s before non-nulls. Defaults follow SQL: `NULLS
    /// FIRST` for ascending is *not* assumed — the parser sets this explicitly.
    pub nulls_first: bool,
}

/// A `SELECT` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct SelectStmt {
    pub distinct: bool,
    pub projection: Vec<SelectItem>,
    /// `None` for a `SELECT` with no `FROM` (constant projection).
    pub from: Option<FromClause>,
    pub selection: Option<Expr>,
    pub group_by: Vec<Expr>,
    pub having: Option<Expr>,
    pub order_by: Vec<OrderByExpr>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

impl SelectStmt {
    /// An empty `SELECT *` shell, used by the parser as a starting point.
    pub fn empty() -> SelectStmt {
        SelectStmt {
            distinct: false,
            projection: Vec::new(),
            from: None,
            selection: None,
            group_by: Vec::new(),
            having: None,
            order_by: Vec::new(),
            limit: None,
            offset: None,
        }
    }
}

/// A column definition in `CREATE TABLE`.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: DataType,
    pub not_null: bool,
}

/// A `CREATE TABLE` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct CreateTableStmt {
    pub name: String,
    pub columns: Vec<ColumnDef>,
    /// `CREATE TABLE IF NOT EXISTS`.
    pub if_not_exists: bool,
}

/// A `DROP TABLE` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct DropTableStmt {
    pub name: String,
    pub if_exists: bool,
}

/// An `INSERT` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct InsertStmt {
    pub table: String,
    /// Explicit column list, if given (`INSERT INTO t (a, b) ...`).
    pub columns: Option<Vec<String>>,
    /// One expression tuple per `VALUES` row.
    pub rows: Vec<Vec<Expr>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_factor_binding_prefers_alias() {
        let tf = TableFactor {
            name: "employees".into(),
            alias: Some("e".into()),
        };
        assert_eq!(tf.binding_name(), "e");
        let tf2 = TableFactor {
            name: "employees".into(),
            alias: None,
        };
        assert_eq!(tf2.binding_name(), "employees");
    }

    #[test]
    fn join_keywords() {
        assert_eq!(JoinType::Inner.keyword(), "INNER JOIN");
        assert_eq!(JoinType::Left.keyword(), "LEFT JOIN");
    }
}
