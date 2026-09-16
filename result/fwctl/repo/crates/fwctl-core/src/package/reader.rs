use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use super::{FIRMWARE_ENTRY, FirmwareManifest, ImageDigest, digest_bytes};
use crate::{FwctlError, Result};

pub const MANIFEST_ENTRY: &str = "manifest.json";
pub const SIGNATURE_ENTRY: &str = "signature.ed25519";
pub const RELEASE_NOTES_ENTRY: &str = "release-notes.txt";
const MAX_MANIFEST_SIZE: u64 = 64 * 1024;
const MAX_RELEASE_NOTES_SIZE: u64 = 256 * 1024;
const SIGNATURE_SIZE: usize = 64;

#[derive(Debug, Clone)]
pub struct FirmwarePackage {
    pub manifest: FirmwareManifest,
    pub image: Vec<u8>,
    pub signature: [u8; SIGNATURE_SIZE],
    pub release_notes: Option<String>,
}

impl FirmwarePackage {
    #[must_use]
    pub fn image_digest(&self) -> ImageDigest {
        digest_bytes(&self.image)
    }
}

pub fn read_package(path: &Path) -> Result<FirmwarePackage> {
    let file = File::open(path).map_err(|err| FwctlError::io(path, err))?;
    read_package_from(file)
}

pub fn read_package_from(source: impl Read + Seek) -> Result<FirmwarePackage> {
    let mut archive = ZipArchive::new(source)
        .map_err(|err| FwctlError::PackageInvalid(format!("invalid package archive: {err}")))?;
    let mut entries = HashMap::with_capacity(archive.len());
    let mut names = HashSet::with_capacity(archive.len());

    for entry_index in 0..archive.len() {
        let entry = archive
            .by_index(entry_index)
            .map_err(|err| zip_error(&err))?;
        let entry_name = entry.name().to_owned();
        if entry.is_dir() || entry.enclosed_name().is_none() {
            return Err(FwctlError::PackageInvalid(format!(
                "unsafe archive entry `{entry_name}`"
            )));
        }
        if !matches!(
            entry_name.as_str(),
            MANIFEST_ENTRY | FIRMWARE_ENTRY | SIGNATURE_ENTRY | RELEASE_NOTES_ENTRY
        ) {
            return Err(FwctlError::PackageInvalid(format!(
                "unexpected archive entry `{entry_name}`"
            )));
        }
        if !names.insert(entry_name.clone()) {
            return Err(FwctlError::PackageInvalid(format!(
                "duplicate archive entry `{entry_name}`"
            )));
        }

        let limit = match entry_name.as_str() {
            MANIFEST_ENTRY => MAX_MANIFEST_SIZE,
            FIRMWARE_ENTRY => super::manifest::MAX_IMAGE_SIZE,
            SIGNATURE_ENTRY => SIGNATURE_SIZE as u64,
            RELEASE_NOTES_ENTRY => MAX_RELEASE_NOTES_SIZE,
            _ => unreachable!(),
        };
        if entry.size() > limit {
            return Err(FwctlError::PackageInvalid(format!(
                "archive entry `{entry_name}` exceeds {limit} bytes"
            )));
        }
        let capacity = usize::try_from(entry.size()).map_err(|_| {
            FwctlError::PackageInvalid(format!(
                "archive entry `{entry_name}` cannot fit in host memory"
            ))
        })?;
        let mut bytes = Vec::with_capacity(capacity);
        entry
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|err| FwctlError::io(&entry_name, err))?;
        if bytes.len() as u64 > limit {
            return Err(FwctlError::PackageInvalid(format!(
                "archive entry `{entry_name}` exceeds {limit} bytes"
            )));
        }
        entries.insert(entry_name, bytes);
    }

    let manifest_bytes = take_required(&mut entries, MANIFEST_ENTRY)?;
    let manifest: FirmwareManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|err| FwctlError::PackageInvalid(format!("invalid manifest JSON: {err}")))?;
    manifest.validate()?;
    if manifest.canonical_bytes()? != manifest_bytes {
        return Err(FwctlError::PackageInvalid(
            "manifest JSON is not in canonical form".into(),
        ));
    }

    let image = take_required(&mut entries, FIRMWARE_ENTRY)?;
    if image.len() as u64 != manifest.image.size {
        return Err(FwctlError::PackageInvalid(format!(
            "image size is {}, manifest declares {}",
            image.len(),
            manifest.image.size
        )));
    }
    if digest_bytes(&image) != manifest.image.sha256 {
        return Err(FwctlError::PackageInvalid(
            "firmware image SHA-256 does not match manifest".into(),
        ));
    }

    let signature: [u8; SIGNATURE_SIZE] = take_required(&mut entries, SIGNATURE_ENTRY)?
        .try_into()
        .map_err(|signature: Vec<u8>| {
            FwctlError::PackageInvalid(format!(
                "Ed25519 signature is {} bytes, expected {SIGNATURE_SIZE}",
                signature.len()
            ))
        })?;
    let release_notes = entries
        .remove(RELEASE_NOTES_ENTRY)
        .map(String::from_utf8)
        .transpose()
        .map_err(|_| FwctlError::PackageInvalid("release notes are not valid UTF-8".into()))?;

    Ok(FirmwarePackage {
        manifest,
        image,
        signature,
        release_notes,
    })
}

fn take_required(entries: &mut HashMap<String, Vec<u8>>, name: &str) -> Result<Vec<u8>> {
    entries
        .remove(name)
        .ok_or_else(|| FwctlError::PackageInvalid(format!("missing `{name}`")))
}

fn zip_error(err: &zip::result::ZipError) -> FwctlError {
    FwctlError::PackageInvalid(format!("invalid package archive: {err}"))
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::*;
    use crate::package::digest_bytes;

    fn manifest(image: &[u8]) -> Vec<u8> {
        FirmwareManifest::new(
            "controller".into(),
            "2.1.0".into(),
            vec!["rev-c".into()],
            image.len() as u64,
            digest_bytes(image),
            8,
            "factory".into(),
        )
        .unwrap()
        .canonical_bytes()
        .unwrap()
    }

    fn archive(entries: &[(&str, &[u8])]) -> Cursor<Vec<u8>> {
        let mut out = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(&mut out);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        out.set_position(0);
        out
    }

    #[test]
    fn reads_complete_package() {
        let image = b"firmware-image";
        let package = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(image)),
            (FIRMWARE_ENTRY, image),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
            (RELEASE_NOTES_ENTRY, b"stable build"),
        ]))
        .unwrap();
        assert_eq!(package.image, image);
        assert_eq!(package.release_notes.as_deref(), Some("stable build"));
    }

    #[test]
    fn rejects_missing_image() {
        let image = b"firmware-image";
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(image)),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("firmware.bin"));
    }

    #[test]
    fn rejects_parent_path_entry() {
        let err = read_package_from(archive(&[("../firmware.bin", b"bad")])).unwrap_err();
        assert!(err.to_string().contains("unsafe"));
    }

    #[test]
    fn rejects_image_hash_mismatch() {
        let expected = b"expected";
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(expected)),
            (FIRMWARE_ENTRY, b"corrupt!"),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("SHA-256"));
    }

    #[test]
    fn rejects_unknown_root_entry() {
        let err = read_package_from(archive(&[("install.sh", b"unexpected")])).unwrap_err();
        assert!(err.to_string().contains("unexpected archive entry"));
    }

    #[test]
    fn rejects_signature_with_wrong_width() {
        let image = b"firmware-image";
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(image)),
            (FIRMWARE_ENTRY, image),
            (SIGNATURE_ENTRY, &[9; SIGNATURE_SIZE - 1]),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("63 bytes"));
    }

    #[test]
    fn rejects_non_utf8_release_notes() {
        let image = b"firmware-image";
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(image)),
            (FIRMWARE_ENTRY, image),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
            (RELEASE_NOTES_ENTRY, &[0xff, 0xfe]),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("UTF-8"));
    }

    #[test]
    fn rejects_semantically_valid_noncanonical_manifest() {
        let image = b"firmware-image";
        let value: serde_json::Value = serde_json::from_slice(&manifest(image)).unwrap();
        let pretty_manifest = serde_json::to_vec_pretty(&value).unwrap();
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &pretty_manifest),
            (FIRMWARE_ENTRY, image),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("canonical"));
    }

    #[test]
    fn enforces_release_notes_decompression_limit() {
        let image = b"firmware-image";
        let note_limit = usize::try_from(MAX_RELEASE_NOTES_SIZE).unwrap();
        let oversized_notes = vec![b'x'; note_limit + 1];
        let err = read_package_from(archive(&[
            (MANIFEST_ENTRY, &manifest(image)),
            (FIRMWARE_ENTRY, image),
            (SIGNATURE_ENTRY, &[7; SIGNATURE_SIZE]),
            (RELEASE_NOTES_ENTRY, &oversized_notes),
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("262144 bytes"));
    }
}
