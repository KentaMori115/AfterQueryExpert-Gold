use std::fmt;
use std::io::Read;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};

use crate::{FwctlError, Result};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ImageDigest([u8; Self::BYTE_LEN]);

impl ImageDigest {
    pub const BYTE_LEN: usize = 32;

    #[must_use]
    pub const fn from_bytes(bytes: [u8; Self::BYTE_LEN]) -> Self {
        Self(bytes)
    }

    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; Self::BYTE_LEN] {
        &self.0
    }

    #[must_use]
    pub fn to_hex(self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Debug for ImageDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("ImageDigest").field(&self.to_hex()).finish()
    }
}

impl fmt::Display for ImageDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl FromStr for ImageDigest {
    type Err = FwctlError;

    fn from_str(value: &str) -> Result<Self> {
        let bytes = hex::decode(value).map_err(|_| {
            FwctlError::PackageInvalid("image SHA-256 must be lowercase hexadecimal".into())
        })?;
        let digest: [u8; Self::BYTE_LEN] = bytes.try_into().map_err(|_| {
            FwctlError::PackageInvalid("image SHA-256 must contain 32 bytes".into())
        })?;
        if value.bytes().any(|byte| byte.is_ascii_uppercase()) {
            return Err(FwctlError::PackageInvalid(
                "image SHA-256 must be lowercase hexadecimal".into(),
            ));
        }
        Ok(Self(digest))
    }
}

impl Serialize for ImageDigest {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for ImageDigest {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        encoded.parse().map_err(serde::de::Error::custom)
    }
}

#[must_use]
pub fn digest_bytes(image: &[u8]) -> ImageDigest {
    let digest: [u8; ImageDigest::BYTE_LEN] = Sha256::digest(image).into();
    ImageDigest(digest)
}

pub fn digest_reader(mut image: impl Read) -> Result<(ImageDigest, u64)> {
    let mut sha256 = Sha256::new();
    let mut buf = [0_u8; 16 * 1024];
    let mut image_size = 0_u64;
    loop {
        let count = image
            .read(&mut buf)
            .map_err(|err| FwctlError::io("firmware image", err))?;
        if count == 0 {
            break;
        }
        sha256.update(&buf[..count]);
        image_size = image_size.checked_add(count as u64).ok_or_else(|| {
            FwctlError::PackageInvalid("firmware image length overflowed u64".into())
        })?;
    }
    Ok((ImageDigest(sha256.finalize().into()), image_size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_known_image() {
        let digest = digest_bytes(b"fwctl");
        assert_eq!(
            digest.to_hex(),
            "53e84e2a6cbc32bcea7a3f33afdcc8ea90ee3bf211b67d44bca0fedfbe40071e"
        );
    }

    #[test]
    fn digest_json_is_canonical_lowercase_hex() {
        let digest = digest_bytes(b"image");
        let json = serde_json::to_string(&digest).unwrap();
        assert_eq!(serde_json::from_str::<ImageDigest>(&json).unwrap(), digest);
        assert!(serde_json::from_str::<ImageDigest>(&json.to_uppercase()).is_err());
    }
}
