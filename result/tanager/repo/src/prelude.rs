//! A convenience prelude re-exporting the types most commonly needed to embed
//! the engine.
//!
//! ```
//! use tanager::prelude::*;
//!
//! let mut db = Database::new();
//! db.execute("CREATE TABLE t (id INTEGER)").unwrap();
//! ```

pub use crate::api::{Database, Outcome, QueryResult};
pub use crate::error::{Error, ErrorKind, Result};
pub use crate::format::render_table;
pub use crate::types::{DataType, Field, Schema, Value};
