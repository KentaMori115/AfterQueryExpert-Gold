//! The function registry: scalar functions and aggregate functions.

pub mod aggregate;
pub mod scalar;
mod scalar_num;
mod scalar_string;

pub use aggregate::{Accumulator, AggregateFn};
pub use scalar::ScalarFn;
