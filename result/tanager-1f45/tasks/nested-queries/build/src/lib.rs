//! # tanager
//!
//! `tanager` is an embeddable, in-memory analytical SQL query engine. It parses
//! a SQL subset, binds and type-checks it against an in-memory catalog, applies
//! a small set of rule-based optimizations, and executes the resulting plan over
//! columnar tables — all with zero external dependencies.
//!
//! # Quick start
//!
//! ```
//! use tanager::Database;
//!
//! let mut db = Database::new();
//! db.execute("CREATE TABLE t (id INTEGER, name TEXT, dept TEXT)").unwrap();
//! db.execute(
//!     "INSERT INTO t VALUES (1, 'Ada', 'eng'), (2, 'Grace', 'eng'), (3, 'Tim', 'ops')",
//! )
//! .unwrap();
//!
//! // Aggregate with grouping and ordering.
//! let result = db
//!     .query("SELECT dept, COUNT(*) AS n FROM t GROUP BY dept ORDER BY n DESC")
//!     .unwrap();
//! assert_eq!(result.columns(), vec!["dept", "n"]);
//! assert_eq!(result.value(0, 0).unwrap().to_string(), "eng");
//! assert_eq!(result.value(0, 1).unwrap().to_string(), "2");
//!
//! // Render a result set as an aligned table.
//! let one = db.query("SELECT name FROM t WHERE id = 3").unwrap();
//! assert!(tanager::render_table(&one).contains("Tim"));
//! ```
//!
//! The crate is organized as a pipeline of stages, each in its own module:
//!
//! * [`types`] — logical types, runtime [`Value`]s, and [`Schema`]s.
//! * [`storage`] — in-memory columnar tables and the catalog.
//! * [`ast`] — the abstract syntax tree produced by the parser.
//! * [`parser`] — the lexer and Pratt parser.
//! * [`planner`] — name/type binding and the logical plan.
//! * [`optimizer`] — rule-based logical-plan rewrites.
//! * [`exec`] — expression evaluation and physical operators.
//! * [`functions`] — the scalar and aggregate function registry.

pub mod api;
pub mod ast;
pub mod error;
pub mod exec;
pub mod format;
pub mod functions;
pub mod optimizer;
pub mod parser;
pub mod planner;
pub mod prelude;
pub mod storage;
pub mod types;

pub use api::{Database, Outcome, QueryResult};
pub use error::{Error, ErrorKind, Result};
pub use format::render_table;
pub use storage::{Catalog, Row, Table};
pub use types::{DataType, Field, Schema, Value};
