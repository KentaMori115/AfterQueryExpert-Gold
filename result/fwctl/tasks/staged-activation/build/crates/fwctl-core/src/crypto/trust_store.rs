use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tempfile::NamedTempFile;

use super::TrustedPublicKey;
use crate::package::digest_bytes;
use crate::{FwctlError, Result};

#[derive(Debug, Clone)]
pub struct TrustStore {
    root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TrustedKeyRecord {
    pub key_id: String,
    pub fingerprint: String,
}

impl TrustStore {
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.root
    }

    pub fn load(&self, key_id: &str) -> Result<TrustedPublicKey> {
        validate_key_id(key_id)?;
        let path = self.key_path(key_id);
        let metadata = fs::symlink_metadata(&path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                FwctlError::UnknownSigningKey(key_id.into())
            } else {
                FwctlError::io(&path, err)
            }
        })?;
        if !metadata.file_type().is_file() {
            return Err(FwctlError::Configuration(format!(
                "trusted key `{}` is not a regular file",
                path.display()
            )));
        }
        TrustedPublicKey::load(key_id, &path)
    }

    pub fn list(&self) -> Result<Vec<TrustedKeyRecord>> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut records = Vec::new();
        let entries = fs::read_dir(&self.root).map_err(|err| FwctlError::io(&self.root, err))?;
        for entry in entries {
            let entry = entry.map_err(|err| FwctlError::io(&self.root, err))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("pub") {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|err| FwctlError::io(&path, err))?;
            if !metadata.file_type().is_file() {
                continue;
            }
            let Some(key_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            let key = TrustedPublicKey::load(key_id, &path)?;
            records.push(record(&key));
        }
        records.sort_unstable_by(|left, right| left.key_id.cmp(&right.key_id));
        Ok(records)
    }

    pub fn add(&self, source: &Path, key_id: &str) -> Result<TrustedKeyRecord> {
        validate_key_id(key_id)?;
        let public_key = TrustedPublicKey::load(key_id, source)?;
        fs::create_dir_all(&self.root).map_err(|err| FwctlError::io(&self.root, err))?;
        let target = self.key_path(key_id);
        let mut staged =
            NamedTempFile::new_in(&self.root).map_err(|err| FwctlError::io(&self.root, err))?;
        writeln!(staged, "{}", hex::encode(public_key.to_bytes()))
            .map_err(|err| FwctlError::io(staged.path(), err))?;
        staged
            .as_file()
            .sync_all()
            .map_err(|err| FwctlError::io(staged.path(), err))?;
        staged.persist_noclobber(&target).map_err(|err| {
            if err.error.kind() == std::io::ErrorKind::AlreadyExists {
                FwctlError::Configuration(format!("trusted key `{key_id}` already exists"))
            } else {
                FwctlError::io(&target, err.error)
            }
        })?;
        Ok(record(&public_key))
    }

    pub fn remove(&self, key_id: &str) -> Result<()> {
        validate_key_id(key_id)?;
        let path = self.key_path(key_id);
        let metadata = fs::symlink_metadata(&path).map_err(|err| FwctlError::io(&path, err))?;
        if !metadata.file_type().is_file() {
            return Err(FwctlError::Configuration(format!(
                "trusted key `{key_id}` is not a regular file"
            )));
        }
        fs::remove_file(&path).map_err(|err| FwctlError::io(path, err))
    }

    fn key_path(&self, key_id: &str) -> PathBuf {
        self.root.join(format!("{key_id}.pub"))
    }
}

fn validate_key_id(key_id: &str) -> Result<()> {
    let valid = !key_id.is_empty()
        && key_id.len() <= 64
        && key_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(FwctlError::Configuration(
            "key ID may contain only letters, digits, '-' and '_'".into(),
        ))
    }
}

fn record(key: &TrustedPublicKey) -> TrustedKeyRecord {
    TrustedKeyRecord {
        key_id: key.key_id.clone(),
        fingerprint: digest_bytes(&key.to_bytes()).to_hex(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::SigningIdentity;

    #[test]
    fn add_list_load_and_remove_key() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pub");
        let identity = SigningIdentity::from_seed("release", [5; 32]);
        fs::write(&source, identity.public_key().to_bytes()).unwrap();
        let store = TrustStore::new(dir.path().join("keys"));

        let added = store.add(&source, "release").unwrap();
        assert_eq!(store.list().unwrap(), [added]);
        assert_eq!(store.load("release").unwrap(), identity.public_key());
        store.remove("release").unwrap();
        assert!(matches!(
            store.load("release"),
            Err(FwctlError::UnknownSigningKey(_))
        ));
    }

    #[test]
    fn does_not_replace_key_identity() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.pub");
        fs::write(
            &source,
            SigningIdentity::from_seed("release", [7; 32])
                .public_key()
                .to_bytes(),
        )
        .unwrap();
        let store = TrustStore::new(dir.path().join("keys"));
        store.add(&source, "release").unwrap();
        assert!(store.add(&source, "release").is_err());
    }

    #[test]
    fn rejects_path_traversal_key_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = TrustStore::new(dir.path());
        assert!(store.load("../release").is_err());
    }
}
