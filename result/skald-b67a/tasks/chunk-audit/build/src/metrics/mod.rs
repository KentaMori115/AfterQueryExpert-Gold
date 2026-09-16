//! Metrics subsystem: bucketed histograms and a named counter registry.
//!
//! Nothing here reaches into the engine on its own. Callers record what they
//! observe, and the reporting side of the crate reads the results back.

pub mod counter;
pub mod histogram;
