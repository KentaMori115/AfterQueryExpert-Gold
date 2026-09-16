use alloc::vec::Vec;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use thiserror::Error;

const SIGNING_DOMAIN: &[u8] = b"FWCTL-PACKAGE-V1\0";
const PACKAGE_FORMAT_VERSION: u32 = 1;
const FIRMWARE_ENTRY: &str = "firmware.bin";

#[derive(Debug, Clone, Copy)]
pub struct TrustedReleaseKey<'a> {
    pub key_id: &'a str,
    pub public_key: [u8; 32],
}

#[derive(Debug, Clone, Copy)]
pub struct UpdateAuthorization<'a> {
    pub format_version: u32,
    pub product: &'a str,
    pub firmware_version: &'a str,
    pub hardware_revisions: &'a [&'a str],
    pub image_file: &'a str,
    pub image_size: u64,
    pub image_digest: [u8; 32],
    pub rollback_counter: u64,
    pub signing_key: &'a str,
    pub signature: [u8; 64],
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AuthorizationError {
    #[error("unsupported package format")]
    UnsupportedFormat,
    #[error("firmware package targets a different product")]
    WrongProduct,
    #[error("firmware package does not authorize this hardware revision")]
    UnsupportedHardware,
    #[error("firmware package names an untrusted signing key")]
    UntrustedKey,
    #[error("firmware authorization has an invalid Ed25519 signature")]
    InvalidSignature,
    #[error("firmware rollback counter is below confirmed policy")]
    RollbackRejected,
    #[error("firmware authorization field exceeds wire limits")]
    FieldTooLong,
    #[error("firmware authorization uses an unexpected image entry")]
    InvalidImageEntry,
}

impl UpdateAuthorization<'_> {
    pub fn verify(
        &self,
        device_product: &str,
        hardware_revision: &str,
        confirmed_rollback_counter: u64,
        trusted_key: TrustedReleaseKey<'_>,
    ) -> Result<(), AuthorizationError> {
        if self.format_version != PACKAGE_FORMAT_VERSION {
            return Err(AuthorizationError::UnsupportedFormat);
        }
        if self.product != device_product {
            return Err(AuthorizationError::WrongProduct);
        }
        if !self.hardware_revisions.contains(&hardware_revision) {
            return Err(AuthorizationError::UnsupportedHardware);
        }
        if self.signing_key != trusted_key.key_id {
            return Err(AuthorizationError::UntrustedKey);
        }
        if self.rollback_counter < confirmed_rollback_counter {
            return Err(AuthorizationError::RollbackRejected);
        }
        if self.image_file != FIRMWARE_ENTRY {
            return Err(AuthorizationError::InvalidImageEntry);
        }
        let verifying_key = VerifyingKey::from_bytes(&trusted_key.public_key)
            .map_err(|_| AuthorizationError::InvalidSignature)?;
        let signature = Signature::from_bytes(&self.signature);
        verifying_key
            .verify(&self.signing_message()?, &signature)
            .map_err(|_| AuthorizationError::InvalidSignature)
    }

    fn signing_message(&self) -> Result<Vec<u8>, AuthorizationError> {
        let mut message = Vec::with_capacity(256);
        message.extend_from_slice(SIGNING_DOMAIN);
        message.extend_from_slice(&self.format_version.to_le_bytes());
        push_text(&mut message, self.product)?;
        push_text(&mut message, self.firmware_version)?;
        let count = u16::try_from(self.hardware_revisions.len())
            .map_err(|_| AuthorizationError::FieldTooLong)?;
        message.extend_from_slice(&count.to_le_bytes());
        for revision in self.hardware_revisions {
            push_text(&mut message, revision)?;
        }
        push_text(&mut message, self.image_file)?;
        message.extend_from_slice(&self.image_size.to_le_bytes());
        message.extend_from_slice(&self.image_digest);
        message.extend_from_slice(&self.rollback_counter.to_le_bytes());
        push_text(&mut message, self.signing_key)?;
        Ok(message)
    }
}

fn push_text(message: &mut Vec<u8>, value: &str) -> Result<(), AuthorizationError> {
    let len = u16::try_from(value.len()).map_err(|_| AuthorizationError::FieldTooLong)?;
    message.extend_from_slice(&len.to_le_bytes());
    message.extend_from_slice(value.as_bytes());
    Ok(())
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;

    fn authorization<'a>(revisions: &'a [&'a str]) -> UpdateAuthorization<'a> {
        UpdateAuthorization {
            format_version: 1,
            product: "sensor-node",
            firmware_version: "1.2.0",
            hardware_revisions: revisions,
            image_file: "firmware.bin",
            image_size: 4096,
            image_digest: [0x51; 32],
            rollback_counter: 12,
            signing_key: "release",
            signature: [0; 64],
        }
    }

    fn signed<'a>(revisions: &'a [&'a str]) -> (UpdateAuthorization<'a>, TrustedReleaseKey<'a>) {
        let signing_key = SigningKey::from_bytes(&[0x27; 32]);
        let mut authorization = authorization(revisions);
        authorization.signature = signing_key
            .sign(&authorization.signing_message().unwrap())
            .to_bytes();
        let trusted = TrustedReleaseKey {
            key_id: "release",
            public_key: signing_key.verifying_key().to_bytes(),
        };
        (authorization, trusted)
    }

    #[test]
    fn accepts_matching_signed_authorization() {
        let (authorization, trusted) = signed(&["A1", "A2"]);
        authorization
            .verify("sensor-node", "A2", 11, trusted)
            .unwrap();
    }

    #[test]
    fn rejects_wrong_hardware_before_flash_work() {
        let (authorization, trusted) = signed(&["A1"]);
        assert_eq!(
            authorization.verify("sensor-node", "B1", 11, trusted),
            Err(AuthorizationError::UnsupportedHardware)
        );
    }

    #[test]
    fn rejects_tampered_image_digest() {
        let (mut authorization, trusted) = signed(&["A1"]);
        authorization.image_digest[0] ^= 1;
        assert_eq!(
            authorization.verify("sensor-node", "A1", 11, trusted),
            Err(AuthorizationError::InvalidSignature)
        );
    }

    #[test]
    fn development_host_cannot_bypass_device_counter() {
        let (authorization, trusted) = signed(&["A1"]);
        assert_eq!(
            authorization.verify("sensor-node", "A1", 13, trusted),
            Err(AuthorizationError::RollbackRejected)
        );
    }
}
