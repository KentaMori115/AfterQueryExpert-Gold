#![forbid(unsafe_code)]

pub mod flash;
pub mod simulator;

pub use flash::VirtualFlash;
pub use simulator::{
    Simulator, SimulatorConfig, SimulatorConnector, SimulatorFaults, SimulatorTrustedKey,
};

pub const DEFAULT_FLASH_SIZE: usize = 2 * 1024 * 1024;
