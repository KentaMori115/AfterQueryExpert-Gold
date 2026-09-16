use semver::Version;

use crate::crypto::{TrustedPublicKey, verify_manifest_signature};
use crate::device::{DeviceInfo, Slot};
use crate::package::{FirmwarePackage, ImageDigest};
use crate::{FwctlError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UpdatePolicy {
    pub allow_downgrade: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePlan {
    pub device_id: String,
    pub product: String,
    pub old_version: String,
    pub new_version: String,
    pub target_slot: Slot,
    pub image_size: u32,
    pub image_digest: ImageDigest,
    pub rollback_counter: u64,
    pub signing_key: String,
}

impl UpdatePolicy {
    pub fn evaluate(
        self,
        package: &FirmwarePackage,
        trusted_key: &TrustedPublicKey,
        device: &DeviceInfo,
    ) -> Result<UpdatePlan> {
        package.manifest.validate()?;
        device.validate()?;
        verify_manifest_signature(&package.manifest, &package.signature, trusted_key)?;
        let manifest = &package.manifest;
        if manifest.product != device.product {
            return Err(FwctlError::WrongProduct {
                package: manifest.product.clone(),
                device: device.product.clone(),
            });
        }
        if !manifest
            .hardware_revisions
            .iter()
            .any(|revision| revision == &device.hardware_revision)
        {
            return Err(FwctlError::UnsupportedHardwareRevision(
                device.hardware_revision.clone(),
            ));
        }
        if manifest.rollback_counter < device.rollback_counter {
            return Err(FwctlError::RollbackRejected {
                package: manifest.rollback_counter,
                confirmed: device.rollback_counter,
            });
        }
        let installed = Version::parse(&device.firmware_version).map_err(|err| {
            FwctlError::ProtocolMismatch(format!("device firmware version is invalid: {err}"))
        })?;
        let candidate = Version::parse(&manifest.firmware_version).map_err(|err| {
            FwctlError::PackageInvalid(format!("firmware version is invalid: {err}"))
        })?;
        if candidate < installed && !self.allow_downgrade {
            return Err(FwctlError::DowngradeRejected {
                installed: installed.to_string(),
                package: candidate.to_string(),
            });
        }
        let image_size = u32::try_from(manifest.image.size).map_err(|_| {
            FwctlError::PackageInvalid("firmware image exceeds protocol size limit".into())
        })?;
        Ok(UpdatePlan {
            device_id: device.device_id.clone(),
            product: device.product.clone(),
            old_version: device.firmware_version.clone(),
            new_version: manifest.firmware_version.clone(),
            target_slot: device.active_slot.inactive(),
            image_size,
            image_digest: manifest.image.sha256,
            rollback_counter: manifest.rollback_counter,
            signing_key: manifest.signing_key.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::crypto::SigningIdentity;
    use crate::device::UpdateState;
    use crate::package::{FirmwareManifest, digest_bytes};

    use super::*;

    fn package(
        signer: &SigningIdentity,
        version: &str,
        product: &str,
        hardware: &[&str],
        counter: u64,
    ) -> FirmwarePackage {
        let image = b"firmware".to_vec();
        let manifest = FirmwareManifest::new(
            product.into(),
            version.into(),
            hardware.iter().map(|value| (*value).into()).collect(),
            image.len() as u64,
            digest_bytes(&image),
            counter,
            signer.key_id().into(),
        )
        .unwrap();
        let signature = signer.sign_manifest(&manifest).unwrap();
        FirmwarePackage {
            manifest,
            image,
            signature,
            release_notes: None,
        }
    }

    fn device() -> DeviceInfo {
        DeviceInfo {
            device_id: "board-4".into(),
            product: "sensor-node".into(),
            hardware_revision: "A2".into(),
            firmware_version: "2.0.0".into(),
            bootloader_version: "0.6.0".into(),
            active_slot: Slot::A,
            candidate_slot: None,
            rollback_counter: 10,
            update_state: UpdateState::Idle,
        }
    }

    #[test]
    fn accepts_authenticated_compatible_upgrade() {
        let signer = SigningIdentity::from_seed("release", [1; 32]);
        let package = package(&signer, "2.1.0", "sensor-node", &["A1", "A2"], 11);
        let plan = UpdatePolicy::default()
            .evaluate(&package, &signer.public_key(), &device())
            .unwrap();
        assert_eq!(plan.target_slot, Slot::B);
        assert_eq!(plan.new_version, "2.1.0");
    }

    #[test]
    fn rejects_wrong_product_and_hardware() {
        let signer = SigningIdentity::from_seed("release", [2; 32]);
        let wrong_product = package(&signer, "2.1.0", "gateway", &["A2"], 11);
        assert!(matches!(
            UpdatePolicy::default().evaluate(&wrong_product, &signer.public_key(), &device()),
            Err(FwctlError::WrongProduct { .. })
        ));
        let wrong_hardware = package(&signer, "2.1.0", "sensor-node", &["C1"], 11);
        assert!(matches!(
            UpdatePolicy::default().evaluate(&wrong_hardware, &signer.public_key(), &device()),
            Err(FwctlError::UnsupportedHardwareRevision(_))
        ));
    }

    #[test]
    fn downgrade_requires_explicit_policy() {
        let signer = SigningIdentity::from_seed("release", [3; 32]);
        let package = package(&signer, "1.9.0", "sensor-node", &["A2"], 10);
        assert!(matches!(
            UpdatePolicy::default().evaluate(&package, &signer.public_key(), &device()),
            Err(FwctlError::DowngradeRejected { .. })
        ));
        assert!(
            UpdatePolicy {
                allow_downgrade: true
            }
            .evaluate(&package, &signer.public_key(), &device())
            .is_ok()
        );
    }

    #[test]
    fn development_downgrade_cannot_bypass_counter() {
        let signer = SigningIdentity::from_seed("release", [4; 32]);
        let package = package(&signer, "1.9.0", "sensor-node", &["A2"], 9);
        assert!(matches!(
            UpdatePolicy {
                allow_downgrade: true
            }
            .evaluate(&package, &signer.public_key(), &device()),
            Err(FwctlError::RollbackRejected { .. })
        ));
    }

    #[test]
    fn rejects_signature_from_other_key() {
        let signer = SigningIdentity::from_seed("release", [5; 32]);
        let package = package(&signer, "2.1.0", "sensor-node", &["A2"], 11);
        let untrusted = SigningIdentity::from_seed("release", [6; 32]);
        assert!(matches!(
            UpdatePolicy::default().evaluate(&package, &untrusted.public_key(), &device()),
            Err(FwctlError::SignatureInvalid)
        ));
    }
}
