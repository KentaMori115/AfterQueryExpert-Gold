//! Execution: expression evaluation and physical operators.

mod agg_exec;
pub mod eval;
pub mod executor;
mod join_exec;
pub mod predicate;
mod sort_exec;

pub use eval::eval;
pub use executor::Executor;
