use std::collections::HashSet;

use semver::Version;
use serde::{Deserialize, Serialize};

use super::ImageDigest;
use crate::{FwctlError, PACKAGE_FORMAT_VERSION, Result};

pub const FIRMWARE_ENTRY: &str = "firmware.bin";
pub const MAX_IMAGE_SIZE: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FirmwareManifest {
    pub format_version: u32,
    pub product: String,
    pub firmware_version: String,
    pub hardware_revisions: Vec<String>,
    pub image: ImageDescriptor,
    pub rollback_counter: u64,
    pub signing_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageDescriptor {
    pub file: String,
    pub size: u64,
    pub sha256: ImageDigest,
}

impl FirmwareManifest {
    pub fn new(
        product: String,
        firmware_version: String,
        hardware_revisions: Vec<String>,
        image_size: u64,
        image_digest: ImageDigest,
        rollback_counter: u64,
        signing_key: String,
    ) -> Result<Self> {
        let manifest = Self {
            format_version: PACKAGE_FORMAT_VERSION,
            product,
            firmware_version,
            hardware_revisions,
            image: ImageDescriptor {
                file: FIRMWARE_ENTRY.into(),
                size: image_size,
                sha256: image_digest,
            },
            rollback_counter,
            signing_key,
        };
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<()> {
        if self.format_version != PACKAGE_FORMAT_VERSION {
            return Err(FwctlError::PackageInvalid(format!(
                "unsupported format version {}",
                self.format_version
            )));
        }
        validate_identifier("product", &self.product)?;
        validate_identifier("signing key", &self.signing_key)?;
        Version::parse(&self.firmware_version).map_err(|err| {
            FwctlError::PackageInvalid(format!("invalid firmware version: {err}"))
        })?;
        if self.hardware_revisions.is_empty() {
            return Err(FwctlError::PackageInvalid(
                "hardware_revisions must not be empty".into(),
            ));
        }
        let mut revisions = HashSet::with_capacity(self.hardware_revisions.len());
        for revision in &self.hardware_revisions {
            validate_identifier("hardware revision", revision)?;
            if !revisions.insert(revision) {
                return Err(FwctlError::PackageInvalid(format!(
                    "duplicate hardware revision `{revision}`"
                )));
            }
        }
        if self.image.file != FIRMWARE_ENTRY {
            return Err(FwctlError::PackageInvalid(format!(
                "image file must be `{FIRMWARE_ENTRY}`"
            )));
        }
        if self.image.size == 0 || self.image.size > MAX_IMAGE_SIZE {
            return Err(FwctlError::PackageInvalid(format!(
                "image size must be between 1 and {MAX_IMAGE_SIZE} bytes"
            )));
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|err| FwctlError::PackageInvalid(err.to_string()))
    }
}

fn validate_identifier(field: &str, value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(FwctlError::PackageInvalid(format!(
            "{field} contains invalid characters"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package::digest_bytes;

    fn manifest() -> FirmwareManifest {
        FirmwareManifest::new(
            "sensor-node".into(),
            "1.4.0".into(),
            vec!["A1".into(), "A2".into()],
            4096,
            digest_bytes(b"image"),
            14,
            "release-main".into(),
        )
        .unwrap()
    }

    #[test]
    fn manifest_round_trip_is_stable() {
        let manifest = manifest();
        let encoded = manifest.canonical_bytes().unwrap();
        assert_eq!(
            serde_json::from_slice::<FirmwareManifest>(&encoded).unwrap(),
            manifest
        );
    }

    #[test]
    fn rejects_duplicate_hardware_revision() {
        let mut manifest = manifest();
        manifest.hardware_revisions.push("A1".into());
        assert!(manifest.validate().is_err());
    }

    #[test]
    fn rejects_path_like_image_name() {
        let mut manifest = manifest();
        manifest.image.file = "../firmware.bin".into();
        assert!(manifest.validate().is_err());
    }

    #[test]
    fn rejects_non_semantic_version() {
        let mut manifest = manifest();
        manifest.firmware_version = "spring-release".into();
        assert!(manifest.validate().is_err());
    }
}
