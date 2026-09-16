#![forbid(unsafe_code)]

pub mod config;
pub mod crypto;
pub mod device;
pub mod error;
pub mod history;
pub mod package;
pub mod protocol;
pub mod transport;
pub mod update;

pub use config::{Config, ConfigPaths};
pub use error::{ErrorCategory, FwctlError, Result};

pub const PACKAGE_FORMAT_VERSION: u32 = 1;
