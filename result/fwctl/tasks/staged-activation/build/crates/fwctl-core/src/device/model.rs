use std::fmt;

use semver::Version;
use serde::{Deserialize, Serialize};

use crate::{FwctlError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    A,
    B,
}

impl Slot {
    #[must_use]
    pub const fn inactive(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

impl fmt::Display for Slot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::A => f.write_str("A"),
            Self::B => f.write_str("B"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateState {
    Idle,
    Preparing,
    Erasing,
    Receiving,
    Verifying,
    CandidateReady,
    AwaitingConfirmation,
    Confirmed,
    RolledBack,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootState {
    Confirmed,
    Candidate,
    Rollback,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct UpdateId([u8; 16]);

impl UpdateId {
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

impl fmt::Debug for UpdateId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "UpdateId({self})")
    }
}

impl fmt::Display for UpdateId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(self.0))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub product: String,
    pub hardware_revision: String,
    pub firmware_version: String,
    pub bootloader_version: String,
    pub active_slot: Slot,
    pub candidate_slot: Option<Slot>,
    pub rollback_counter: u64,
    pub update_state: UpdateState,
}

impl DeviceInfo {
    pub fn validate(&self) -> Result<()> {
        validate_text("device ID", &self.device_id, 96)?;
        validate_text("product", &self.product, 64)?;
        validate_text("hardware revision", &self.hardware_revision, 64)?;
        Version::parse(&self.firmware_version).map_err(|err| {
            FwctlError::ProtocolMismatch(format!("invalid device firmware version: {err}"))
        })?;
        Version::parse(&self.bootloader_version).map_err(|err| {
            FwctlError::ProtocolMismatch(format!("invalid bootloader version: {err}"))
        })?;
        if self.candidate_slot == Some(self.active_slot) {
            return Err(FwctlError::ProtocolMismatch(
                "active and candidate slots must differ".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub state: UpdateState,
    pub boot_state: BootState,
    pub update_id: Option<UpdateId>,
    pub accepted_offset: u32,
    pub candidate_healthy: bool,
    pub boot_attempts: u8,
}

fn validate_text(field: &str, value: &str, max_len: usize) -> Result<()> {
    if value.is_empty() || value.len() > max_len || value.chars().any(char::is_control) {
        Err(FwctlError::ProtocolMismatch(format!(
            "invalid {field} in device response"
        )))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> DeviceInfo {
        DeviceInfo {
            device_id: "usb-340012ab".into(),
            product: "sensor-node".into(),
            hardware_revision: "A2".into(),
            firmware_version: "1.4.0".into(),
            bootloader_version: "0.8.1".into(),
            active_slot: Slot::A,
            candidate_slot: None,
            rollback_counter: 12,
            update_state: UpdateState::Idle,
        }
    }

    #[test]
    fn inactive_slot_is_symmetric() {
        assert_eq!(Slot::A.inactive(), Slot::B);
        assert_eq!(Slot::B.inactive(), Slot::A);
    }

    #[test]
    fn validates_consistent_device_info() {
        assert!(info().validate().is_ok());
    }

    #[test]
    fn rejects_candidate_in_active_slot() {
        let mut info = info();
        info.candidate_slot = Some(Slot::A);
        assert!(info.validate().is_err());
    }

    #[test]
    fn update_id_has_fixed_width_display() {
        assert_eq!(UpdateId::from_bytes([0xa5; 16]).to_string().len(), 32);
    }
}
