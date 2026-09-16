use std::path::Path;

use fwctl_core::crypto::{
    KeyPermissions, SigningIdentity, TrustStore, inspect_private_key_permissions,
    verify_manifest_signature,
};
use fwctl_core::package::{PackageSpec, read_package, write_package};
use fwctl_core::{Config, Result};
use serde::Serialize;

use crate::cli::{PackageArgs, PackagePath};
use crate::output::StdOutput;

#[derive(Serialize)]
struct PackageResult<'a> {
    package: &'a Path,
    product: &'a str,
    firmware_version: &'a str,
    image_size: u64,
    image_sha256: String,
    signing_key: &'a str,
}

#[derive(Serialize)]
struct InspectionResult<'a> {
    package: &'a Path,
    format_version: u32,
    product: &'a str,
    firmware_version: &'a str,
    hardware_revisions: &'a [String],
    image_size: u64,
    image_sha256: String,
    rollback_counter: u64,
    signing_key: &'a str,
    has_release_notes: bool,
}

#[derive(Serialize)]
struct VerificationResult<'a> {
    package: &'a Path,
    verified: bool,
    product: &'a str,
    firmware_version: &'a str,
    image_sha256: String,
    signing_key: &'a str,
}

pub fn create(args: &PackageArgs, output: &mut StdOutput) -> Result<()> {
    let key_id = args
        .key
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("release");
    if let KeyPermissions::GroupOrWorldReadable(mode) = inspect_private_key_permissions(&args.key) {
        output.warning(format_args!(
            "private key {} has permissions {mode:o}; use mode 600",
            args.key.display()
        ))?;
    }
    let signer = SigningIdentity::load(key_id, &args.key)?;
    let spec = PackageSpec {
        product: args.product.clone(),
        firmware_version: args.version.clone(),
        hardware_revisions: args.hardware.clone(),
        rollback_counter: args.rollback_counter,
        image_path: args.image.clone(),
        release_notes_path: args.release_notes.clone(),
        output_path: args.output.clone(),
        force: args.force,
    };
    output.progress(format_args!("Reading and signing {}", args.image.display()))?;
    let manifest = write_package(&spec, &signer)?;
    let result = PackageResult {
        package: &args.output,
        product: &manifest.product,
        firmware_version: &manifest.firmware_version,
        image_size: manifest.image.size,
        image_sha256: manifest.image.sha256.to_hex(),
        signing_key: &manifest.signing_key,
    };
    output.success(
        &result,
        format_args!(
            "Created {}\n  Product: {}\n  Version: {}\n  Image: {} bytes\n  SHA-256: {}\n  Signing key: {}",
            result.package.display(),
            result.product,
            result.firmware_version,
            result.image_size,
            result.image_sha256,
            result.signing_key
        ),
    )
}

pub fn inspect(args: &PackagePath, output: &mut StdOutput) -> Result<()> {
    let package = read_package(&args.package)?;
    let manifest = &package.manifest;
    let result = InspectionResult {
        package: &args.package,
        format_version: manifest.format_version,
        product: &manifest.product,
        firmware_version: &manifest.firmware_version,
        hardware_revisions: &manifest.hardware_revisions,
        image_size: manifest.image.size,
        image_sha256: manifest.image.sha256.to_hex(),
        rollback_counter: manifest.rollback_counter,
        signing_key: &manifest.signing_key,
        has_release_notes: package.release_notes.is_some(),
    };
    output.success(
        &result,
        format_args!(
            "Package: {}\n  Product: {}\n  Version: {}\n  Hardware: {}\n  Image: {} bytes\n  SHA-256: {}\n  Rollback counter: {}\n  Signing key: {}",
            result.package.display(),
            result.product,
            result.firmware_version,
            result.hardware_revisions.join(", "),
            result.image_size,
            result.image_sha256,
            result.rollback_counter,
            result.signing_key
        ),
    )
}

pub fn verify(args: &PackagePath, config: &Config, output: &mut StdOutput) -> Result<()> {
    let package = read_package(&args.package)?;
    let trusted_key = TrustStore::new(&config.trust_store).load(&package.manifest.signing_key)?;
    verify_manifest_signature(&package.manifest, &package.signature, &trusted_key)?;
    let result = VerificationResult {
        package: &args.package,
        verified: true,
        product: &package.manifest.product,
        firmware_version: &package.manifest.firmware_version,
        image_sha256: package.manifest.image.sha256.to_hex(),
        signing_key: &package.manifest.signing_key,
    };
    output.success(
        &result,
        format_args!(
            "Verified {}\n  Product: {}\n  Version: {}\n  SHA-256: {}\n  Signing key: {}",
            result.package.display(),
            result.product,
            result.firmware_version,
            result.image_sha256,
            result.signing_key
        ),
    )
}
