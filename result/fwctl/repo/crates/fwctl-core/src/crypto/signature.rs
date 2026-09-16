use std::fs;
use std::path::Path;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

use crate::package::FirmwareManifest;
use crate::{FwctlError, Result};

const SIGNING_DOMAIN: &[u8] = b"FWCTL-PACKAGE-V1\0";

pub struct SigningIdentity {
    key_id: String,
    signing_key: SigningKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedPublicKey {
    pub key_id: String,
    verifying_key: VerifyingKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyPermissions {
    Secure,
    GroupOrWorldReadable(u32),
    Unknown,
}

impl SigningIdentity {
    pub fn load(key_id: impl Into<String>, path: &Path) -> Result<Self> {
        let bytes = fs::read(path).map_err(|err| FwctlError::io(path, err))?;
        let seed = decode_key_bytes(&bytes, "private signing key")?;
        Ok(Self {
            key_id: key_id.into(),
            signing_key: SigningKey::from_bytes(&seed),
        })
    }

    #[must_use]
    pub fn from_seed(key_id: impl Into<String>, seed: [u8; 32]) -> Self {
        Self {
            key_id: key_id.into(),
            signing_key: SigningKey::from_bytes(&seed),
        }
    }

    #[must_use]
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    #[must_use]
    pub fn public_key(&self) -> TrustedPublicKey {
        TrustedPublicKey {
            key_id: self.key_id.clone(),
            verifying_key: self.signing_key.verifying_key(),
        }
    }

    pub fn sign_manifest(&self, manifest: &FirmwareManifest) -> Result<[u8; 64]> {
        if manifest.signing_key != self.key_id {
            return Err(FwctlError::PackageInvalid(format!(
                "manifest key `{}` does not match loaded key `{}`",
                manifest.signing_key, self.key_id
            )));
        }
        let message = manifest_signing_message(manifest)?;
        Ok(self.signing_key.sign(&message).to_bytes())
    }
}

impl TrustedPublicKey {
    pub fn load(key_id: impl Into<String>, path: &Path) -> Result<Self> {
        let bytes = fs::read(path).map_err(|err| FwctlError::io(path, err))?;
        let encoded = decode_key_bytes(&bytes, "public signing key")?;
        let verifying_key = VerifyingKey::from_bytes(&encoded)
            .map_err(|_| FwctlError::PackageInvalid("invalid Ed25519 public key".into()))?;
        Ok(Self {
            key_id: key_id.into(),
            verifying_key,
        })
    }

    pub fn from_bytes(key_id: impl Into<String>, bytes: [u8; 32]) -> Result<Self> {
        let verifying_key = VerifyingKey::from_bytes(&bytes)
            .map_err(|_| FwctlError::PackageInvalid("invalid Ed25519 public key".into()))?;
        Ok(Self {
            key_id: key_id.into(),
            verifying_key,
        })
    }

    #[must_use]
    pub fn to_bytes(&self) -> [u8; 32] {
        self.verifying_key.to_bytes()
    }
}

pub fn verify_manifest_signature(
    manifest: &FirmwareManifest,
    signature: &[u8; 64],
    trusted_key: &TrustedPublicKey,
) -> Result<()> {
    if manifest.signing_key != trusted_key.key_id {
        return Err(FwctlError::UnknownSigningKey(manifest.signing_key.clone()));
    }
    let signature = Signature::from_bytes(signature);
    let message = manifest_signing_message(manifest)?;
    trusted_key
        .verifying_key
        .verify(&message, &signature)
        .map_err(|_| FwctlError::SignatureInvalid)
}

#[must_use]
pub fn inspect_private_key_permissions(path: &Path) -> KeyPermissions {
    permissions(path)
}

#[cfg(unix)]
fn permissions(path: &Path) -> KeyPermissions {
    use std::os::unix::fs::PermissionsExt;

    match fs::metadata(path) {
        Ok(metadata) => {
            let mode = metadata.permissions().mode() & 0o777;
            if mode.is_multiple_of(0o100) {
                KeyPermissions::Secure
            } else {
                KeyPermissions::GroupOrWorldReadable(mode)
            }
        }
        Err(_) => KeyPermissions::Unknown,
    }
}

#[cfg(not(unix))]
fn permissions(_path: &Path) -> KeyPermissions {
    KeyPermissions::Unknown
}

pub fn manifest_signing_message(manifest: &FirmwareManifest) -> Result<Vec<u8>> {
    manifest.validate()?;
    let mut message = Vec::with_capacity(256);
    message.extend_from_slice(SIGNING_DOMAIN);
    message.extend_from_slice(&manifest.format_version.to_le_bytes());
    push_text(&mut message, &manifest.product)?;
    push_text(&mut message, &manifest.firmware_version)?;
    let revision_count = u16::try_from(manifest.hardware_revisions.len()).map_err(|_| {
        FwctlError::PackageInvalid("too many hardware revisions in manifest".into())
    })?;
    message.extend_from_slice(&revision_count.to_le_bytes());
    for revision in &manifest.hardware_revisions {
        push_text(&mut message, revision)?;
    }
    push_text(&mut message, &manifest.image.file)?;
    message.extend_from_slice(&manifest.image.size.to_le_bytes());
    message.extend_from_slice(manifest.image.sha256.as_bytes());
    message.extend_from_slice(&manifest.rollback_counter.to_le_bytes());
    push_text(&mut message, &manifest.signing_key)?;
    Ok(message)
}

fn push_text(message: &mut Vec<u8>, value: &str) -> Result<()> {
    let len = u16::try_from(value.len())
        .map_err(|_| FwctlError::PackageInvalid("signed manifest field is too long".into()))?;
    message.extend_from_slice(&len.to_le_bytes());
    message.extend_from_slice(value.as_bytes());
    Ok(())
}

fn decode_key_bytes(bytes: &[u8], label: &str) -> Result<[u8; 32]> {
    if let Ok(raw) = <[u8; 32]>::try_from(bytes) {
        return Ok(raw);
    }
    let text = std::str::from_utf8(bytes)
        .map(str::trim)
        .map_err(|_| FwctlError::PackageInvalid(format!("{label} is neither raw nor hex")))?;
    let decoded = hex::decode(text)
        .map_err(|_| FwctlError::PackageInvalid(format!("{label} contains invalid hex")))?;
    decoded
        .try_into()
        .map_err(|_| FwctlError::PackageInvalid(format!("{label} must contain 32 bytes")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package::{FirmwareManifest, digest_bytes};

    fn manifest(key_id: &str) -> FirmwareManifest {
        FirmwareManifest::new(
            "meter".into(),
            "3.2.1".into(),
            vec!["D2".into()],
            5,
            digest_bytes(b"image"),
            21,
            key_id.into(),
        )
        .unwrap()
    }

    #[test]
    fn signs_and_verifies_manifest() {
        let signing_key = SigningIdentity::from_seed("release", [0x42; 32]);
        let manifest = manifest("release");
        let signature = signing_key.sign_manifest(&manifest).unwrap();
        verify_manifest_signature(&manifest, &signature, &signing_key.public_key()).unwrap();
    }

    #[test]
    fn rejects_changed_manifest() {
        let signing_key = SigningIdentity::from_seed("release", [0x24; 32]);
        let mut manifest = manifest("release");
        let signature = signing_key.sign_manifest(&manifest).unwrap();
        manifest.rollback_counter += 1;
        assert!(matches!(
            verify_manifest_signature(&manifest, &signature, &signing_key.public_key()),
            Err(FwctlError::SignatureInvalid)
        ));
    }

    #[test]
    fn signed_payload_covers_hardware_and_image_identity() {
        let signing_key = SigningIdentity::from_seed("release", [0x31; 32]);
        let mut manifest = manifest("release");
        let signature = signing_key.sign_manifest(&manifest).unwrap();
        manifest.hardware_revisions[0] = "D3".into();
        assert!(
            verify_manifest_signature(&manifest, &signature, &signing_key.public_key()).is_err()
        );
        manifest.hardware_revisions[0] = "D2".into();
        manifest.image.sha256 = crate::package::digest_bytes(b"other");
        assert!(
            verify_manifest_signature(&manifest, &signature, &signing_key.public_key()).is_err()
        );
    }

    #[test]
    fn rejects_wrong_key_identity() {
        let signing_key = SigningIdentity::from_seed("release", [0x24; 32]);
        let manifest = manifest("release");
        let signature = signing_key.sign_manifest(&manifest).unwrap();
        let other = SigningIdentity::from_seed("staging", [0x24; 32]);
        assert!(matches!(
            verify_manifest_signature(&manifest, &signature, &other.public_key()),
            Err(FwctlError::UnknownSigningKey(_))
        ));
    }

    #[test]
    fn loads_hex_encoded_seed_without_exposing_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("release.key");
        fs::write(&path, hex::encode([3_u8; 32])).unwrap();
        let identity = SigningIdentity::load("release", &path).unwrap();
        assert_eq!(identity.key_id(), "release");
    }
}
