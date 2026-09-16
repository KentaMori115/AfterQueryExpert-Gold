//! skald — an embeddable garbage-collected bytecode scripting engine.
//!
//! The crate is organised the same way the reference C engine was: a
//! reference-counted object [`heap`], a tri-color [`gc`], a binary
//! [`bytecode`] loader, a [`lexer`], and a stack-based [`vm`], plus supporting
//! data-structure and standard-library modules.

pub mod bytecode;
pub mod diag;
pub mod display;
pub mod ds;
pub mod gc;
pub mod heap;
pub mod json;
pub mod lexer;
pub mod metrics;
pub mod stdlib;
pub mod symbol;
pub mod util;
pub mod value;
pub mod vm;
