use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::manifest::MAX_IMAGE_SIZE;
use super::reader::{MANIFEST_ENTRY, RELEASE_NOTES_ENTRY, SIGNATURE_ENTRY};
use super::{FIRMWARE_ENTRY, FirmwareManifest, digest_bytes};
use crate::crypto::SigningIdentity;
use crate::{FwctlError, Result};

const MAX_RELEASE_NOTES_SIZE: u64 = 256 * 1024;

#[derive(Debug, Clone)]
pub struct PackageSpec {
    pub product: String,
    pub firmware_version: String,
    pub hardware_revisions: Vec<String>,
    pub rollback_counter: u64,
    pub image_path: PathBuf,
    pub release_notes_path: Option<PathBuf>,
    pub output_path: PathBuf,
    pub force: bool,
}

pub fn write_package(spec: &PackageSpec, signer: &SigningIdentity) -> Result<FirmwareManifest> {
    if spec.output_path.exists() && !spec.force {
        return Err(FwctlError::PackageInvalid(format!(
            "output `{}` already exists; use --force to replace it",
            spec.output_path.display()
        )));
    }
    let image = read_bounded(&spec.image_path, MAX_IMAGE_SIZE, "firmware image")?;
    if image.is_empty() {
        return Err(FwctlError::PackageInvalid(
            "firmware image must not be empty".into(),
        ));
    }
    let release_notes = spec
        .release_notes_path
        .as_deref()
        .map(|path| read_bounded(path, MAX_RELEASE_NOTES_SIZE, "release notes"))
        .transpose()?;
    if let Some(notes) = &release_notes {
        std::str::from_utf8(notes)
            .map_err(|_| FwctlError::PackageInvalid("release notes are not valid UTF-8".into()))?;
    }

    let manifest = FirmwareManifest::new(
        spec.product.clone(),
        spec.firmware_version.clone(),
        spec.hardware_revisions.clone(),
        image.len() as u64,
        digest_bytes(&image),
        spec.rollback_counter,
        signer.key_id().to_owned(),
    )?;
    let manifest_bytes = manifest.canonical_bytes()?;
    let signature = signer.sign_manifest(&manifest)?;

    let output_dir = spec.output_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(output_dir).map_err(|err| FwctlError::io(output_dir, err))?;
    let mut staged =
        NamedTempFile::new_in(output_dir).map_err(|err| FwctlError::io(output_dir, err))?;
    write_archive(
        staged.as_file_mut(),
        &manifest_bytes,
        &image,
        &signature,
        release_notes.as_deref(),
    )?;
    staged
        .as_file()
        .sync_all()
        .map_err(|err| FwctlError::io(staged.path(), err))?;

    if spec.force {
        staged
            .persist(&spec.output_path)
            .map_err(|err| FwctlError::io(&spec.output_path, err.error))?;
    } else {
        staged
            .persist_noclobber(&spec.output_path)
            .map_err(|err| FwctlError::io(&spec.output_path, err.error))?;
    }
    Ok(manifest)
}

fn write_archive(
    output: &mut File,
    manifest: &[u8],
    image: &[u8],
    signature: &[u8; 64],
    release_notes: Option<&[u8]>,
) -> Result<()> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut archive = ZipWriter::new(output);
    write_entry(&mut archive, MANIFEST_ENTRY, manifest, options)?;
    write_entry(&mut archive, FIRMWARE_ENTRY, image, options)?;
    write_entry(&mut archive, SIGNATURE_ENTRY, signature, options)?;
    if let Some(notes) = release_notes {
        write_entry(&mut archive, RELEASE_NOTES_ENTRY, notes, options)?;
    }
    archive
        .finish()
        .map_err(|err| FwctlError::PackageInvalid(format!("could not finish package: {err}")))?;
    Ok(())
}

fn write_entry<W: Write + std::io::Seek>(
    archive: &mut ZipWriter<W>,
    name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<()> {
    archive
        .start_file(name, options)
        .map_err(|err| FwctlError::PackageInvalid(format!("could not write `{name}`: {err}")))?;
    archive
        .write_all(bytes)
        .map_err(|err| FwctlError::io(name, err))
}

fn read_bounded(path: &Path, limit: u64, label: &str) -> Result<Vec<u8>> {
    let file = File::open(path).map_err(|err| FwctlError::io(path, err))?;
    let length = file
        .metadata()
        .map_err(|err| FwctlError::io(path, err))?
        .len();
    if length > limit {
        return Err(FwctlError::PackageInvalid(format!(
            "{label} exceeds {limit} bytes"
        )));
    }
    let capacity = usize::try_from(length)
        .map_err(|_| FwctlError::PackageInvalid(format!("{label} cannot fit in host memory")))?;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| FwctlError::io(path, err))?;
    if bytes.len() as u64 > limit {
        return Err(FwctlError::PackageInvalid(format!(
            "{label} exceeds {limit} bytes"
        )));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::verify_manifest_signature;
    use crate::package::read_package;

    fn spec(dir: &Path) -> PackageSpec {
        let image_path = dir.join("app.bin");
        fs::write(&image_path, b"candidate firmware").unwrap();
        PackageSpec {
            product: "controller".into(),
            firmware_version: "1.3.0".into(),
            hardware_revisions: vec!["B1".into()],
            rollback_counter: 13,
            image_path,
            release_notes_path: None,
            output_path: dir.join("candidate.fwpkg"),
            force: false,
        }
    }

    #[test]
    fn creates_readable_signed_package() {
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path());
        let signer = SigningIdentity::from_seed("release", [9; 32]);
        write_package(&spec, &signer).unwrap();

        let package = read_package(&spec.output_path).unwrap();
        assert_eq!(package.image, b"candidate firmware");
        verify_manifest_signature(&package.manifest, &package.signature, &signer.public_key())
            .unwrap();
    }

    #[test]
    fn refuses_to_replace_existing_output() {
        let dir = tempfile::tempdir().unwrap();
        let spec = spec(dir.path());
        let signer = SigningIdentity::from_seed("release", [4; 32]);
        fs::write(&spec.output_path, b"keep me").unwrap();
        assert!(write_package(&spec, &signer).is_err());
        assert_eq!(fs::read(&spec.output_path).unwrap(), b"keep me");
    }

    #[test]
    fn force_replaces_output_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let mut spec = spec(dir.path());
        spec.force = true;
        let signer = SigningIdentity::from_seed("release", [4; 32]);
        fs::write(&spec.output_path, b"old package").unwrap();
        write_package(&spec, &signer).unwrap();
        assert!(read_package(&spec.output_path).is_ok());
    }
}
