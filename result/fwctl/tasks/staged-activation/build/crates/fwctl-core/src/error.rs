use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type Result<T> = std::result::Result<T, FwctlError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Configuration,
    PackageInvalid,
    SignatureInvalid,
    UnknownSigningKey,
    DeviceNotFound,
    ProtocolMismatch,
    TransportTimeout,
    TransportDisconnected,
    WrongProduct,
    UnsupportedHardwareRevision,
    DowngradeRejected,
    RollbackRejected,
    FlashFailure,
    ImageVerificationFailed,
    RebootTimeout,
    HealthCheckFailed,
    AutomaticRollback,
    NothingStaged,
    StagedUpdateLost,
    Io,
}

#[derive(Debug, Error)]
pub enum FwctlError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("invalid firmware package: {0}")]
    PackageInvalid(String),
    #[error("firmware signature is invalid")]
    SignatureInvalid,
    #[error("signing key `{0}` is not trusted")]
    UnknownSigningKey(String),
    #[error("device `{0}` was not found")]
    DeviceNotFound(String),
    #[error("protocol mismatch: {0}")]
    ProtocolMismatch(String),
    #[error("transport timed out while {operation}")]
    TransportTimeout { operation: &'static str },
    #[error("device disconnected while {operation}")]
    TransportDisconnected { operation: &'static str },
    #[error("package targets product `{package}`, but device is `{device}`")]
    WrongProduct { package: String, device: String },
    #[error("hardware revision `{0}` is not supported by this package")]
    UnsupportedHardwareRevision(String),
    #[error("firmware downgrade from {installed} to {package} was rejected")]
    DowngradeRejected { installed: String, package: String },
    #[error("rollback counter {package} is below confirmed counter {confirmed}")]
    RollbackRejected { package: u64, confirmed: u64 },
    #[error("flash operation failed: {0}")]
    FlashFailure(String),
    #[error("device-side image verification failed")]
    ImageVerificationFailed,
    #[error("device did not reconnect after reboot")]
    RebootTimeout,
    #[error("candidate firmware did not report healthy state")]
    HealthCheckFailed,
    #[error("candidate firmware failed and the device rolled back")]
    AutomaticRollback,
    #[error("device `{0}` has no staged firmware update")]
    NothingStaged(String),
    #[error("device `{0}` no longer holds the staged firmware update")]
    StagedUpdateLost(String),
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}

impl FwctlError {
    #[must_use]
    pub const fn category(&self) -> ErrorCategory {
        match self {
            Self::Configuration(_) => ErrorCategory::Configuration,
            Self::PackageInvalid(_) => ErrorCategory::PackageInvalid,
            Self::SignatureInvalid => ErrorCategory::SignatureInvalid,
            Self::UnknownSigningKey(_) => ErrorCategory::UnknownSigningKey,
            Self::DeviceNotFound(_) => ErrorCategory::DeviceNotFound,
            Self::ProtocolMismatch(_) => ErrorCategory::ProtocolMismatch,
            Self::TransportTimeout { .. } => ErrorCategory::TransportTimeout,
            Self::TransportDisconnected { .. } => ErrorCategory::TransportDisconnected,
            Self::WrongProduct { .. } => ErrorCategory::WrongProduct,
            Self::UnsupportedHardwareRevision(_) => ErrorCategory::UnsupportedHardwareRevision,
            Self::DowngradeRejected { .. } => ErrorCategory::DowngradeRejected,
            Self::RollbackRejected { .. } => ErrorCategory::RollbackRejected,
            Self::FlashFailure(_) => ErrorCategory::FlashFailure,
            Self::ImageVerificationFailed => ErrorCategory::ImageVerificationFailed,
            Self::RebootTimeout => ErrorCategory::RebootTimeout,
            Self::HealthCheckFailed => ErrorCategory::HealthCheckFailed,
            Self::AutomaticRollback => ErrorCategory::AutomaticRollback,
            Self::NothingStaged(_) => ErrorCategory::NothingStaged,
            Self::StagedUpdateLost(_) => ErrorCategory::StagedUpdateLost,
            Self::Io { .. } => ErrorCategory::Io,
        }
    }

    pub fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}
