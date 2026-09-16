use std::time::Duration;

use fwctl_core::crypto::SigningIdentity;
use fwctl_core::package::{FirmwareManifest, FirmwarePackage, digest_bytes};
use fwctl_core::update::{UpdateEngine, UpdatePolicy, UpdateState};
use fwctl_core::{ErrorCategory, FwctlError};
use fwctl_sim::{Simulator, SimulatorConfig, SimulatorConnector, SimulatorTrustedKey};

fn signed_package(signer: &SigningIdentity, image_len: usize) -> FirmwarePackage {
    let image = (0..image_len)
        .map(|offset| u8::try_from(offset % 251).unwrap())
        .collect::<Vec<_>>();
    let manifest = FirmwareManifest::new(
        "sensor-node".into(),
        "1.1.0".into(),
        vec!["A1".into()],
        image.len() as u64,
        digest_bytes(&image),
        2,
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

fn engine(simulator: Simulator) -> UpdateEngine<SimulatorConnector> {
    UpdateEngine::new(
        SimulatorConnector::new(simulator),
        Duration::from_millis(30),
        Duration::from_secs(1),
        512,
    )
}

fn simulator(signer: &SigningIdentity) -> Simulator {
    let config = SimulatorConfig {
        trusted_keys: vec![SimulatorTrustedKey {
            key_id: signer.key_id().into(),
            public_key: signer.public_key().to_bytes(),
        }],
        ..SimulatorConfig::default()
    };
    Simulator::new(config).unwrap()
}

fn resign(package: &mut FirmwarePackage, signer: &SigningIdentity) {
    package.signature = signer.sign_manifest(&package.manifest).unwrap();
}

#[test]
fn completes_full_host_to_device_update() {
    let signer = SigningIdentity::from_seed("release", [0x19; 32]);
    let package = signed_package(&signer, 5000);
    let simulator = simulator(&signer);
    let mut engine = engine(simulator);
    let mut states = Vec::new();
    let report = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |event| states.push(event.state),
        )
        .unwrap();
    assert_eq!(report.state, UpdateState::Completed);
    assert_eq!(report.target_slot, fwctl_core::device::Slot::B);
    assert!(states.contains(&UpdateState::Verifying));
    assert!(states.contains(&UpdateState::Confirming));

    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.1.0");
    assert_eq!(simulator.info().rollback_counter, 2);
}

#[test]
fn reconnects_and_resumes_at_device_offset() {
    let signer = SigningIdentity::from_seed("release", [0x29; 32]);
    let package = signed_package(&signer, 4096);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().disconnect_at_chunk = Some(2);
    let mut engine = engine(simulator);
    let report = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap();
    assert_eq!(report.resumed_connections, 1);
    assert_eq!(report.state, UpdateState::Completed);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn device_hash_mismatch_never_reaches_candidate_state() {
    let signer = SigningIdentity::from_seed("release", [0x39; 32]);
    let package = signed_package(&signer, 2048);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().force_verify_failure = true;
    let mut engine = engine(simulator);
    let err = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::ImageVerificationFailed));
    assert_eq!(engine.state(), UpdateState::Failed);
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn unhealthy_candidate_is_not_confirmed() {
    let signer = SigningIdentity::from_seed("release", [0x49; 32]);
    let package = signed_package(&signer, 1024);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().candidate_healthy = false;
    let mut engine = engine(simulator);
    let err = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::HealthCheckFailed));
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_some());
    assert_eq!(simulator.info().rollback_counter, 1);
}

#[test]
fn device_rejects_key_trusted_only_by_host() {
    let signer = SigningIdentity::from_seed("release", [0x59; 32]);
    let package = signed_package(&signer, 1024);
    let simulator = Simulator::new(SimulatorConfig::default()).unwrap();
    let mut engine = engine(simulator);
    let err = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::ProtocolMismatch(_)));
    assert!(err.to_string().contains("invalid Ed25519 signature"));
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn flash_driver_failure_aborts_before_image_verification() {
    let signer = SigningIdentity::from_seed("release", [0x69; 32]);
    let package = signed_package(&signer, 1536);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().flash_failure_at = Some(512);
    let mut engine = engine(simulator);
    let mut states = Vec::new();

    let err = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |event| states.push(event.state),
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::ProtocolMismatch(_)));
    assert!(err.to_string().contains("flash driver failed"), "{err}");
    assert!(!states.contains(&UpdateState::Verifying));
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn reboot_failure_reaches_bounded_reconnect_timeout() {
    let signer = SigningIdentity::from_seed("release", [0x79; 32]);
    let package = signed_package(&signer, 768);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().reboot_failure = true;
    let mut engine = engine(simulator);

    let err = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::RebootTimeout));
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.0.0");
    assert!(simulator.info().candidate_slot.is_some());
}

#[test]
fn unhealthy_candidate_rolls_back_after_boot_budget() {
    let signer = SigningIdentity::from_seed("release", [0x89; 32]);
    let package = signed_package(&signer, 896);
    let mut simulator = simulator(&signer);
    simulator.faults_mut().candidate_healthy = false;
    let mut engine = engine(simulator);

    assert!(matches!(
        engine.run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        ),
        Err(FwctlError::HealthCheckFailed)
    ));
    let mut simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.status().boot_attempts, 1);

    simulator
        .handle(fwctl_core::protocol::ProtocolMessage::Reboot)
        .unwrap();
    assert_eq!(simulator.status().boot_attempts, 2);
    simulator
        .handle(fwctl_core::protocol::ProtocolMessage::Reboot)
        .unwrap();

    assert_eq!(simulator.info().active_slot, fwctl_core::device::Slot::A);
    assert_eq!(simulator.info().firmware_version, "1.0.0");
    assert_eq!(
        simulator.info().update_state,
        fwctl_core::device::UpdateState::RolledBack
    );
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn engine_policy_rejections_never_reach_device_mutation() {
    let signer = SigningIdentity::from_seed("release", [0x99; 32]);

    let mut wrong_product = signed_package(&signer, 512);
    wrong_product.manifest.product = "motor-drive".into();
    resign(&mut wrong_product, &signer);

    let mut wrong_hardware = signed_package(&signer, 512);
    wrong_hardware.manifest.hardware_revisions = vec!["B9".into()];
    resign(&mut wrong_hardware, &signer);

    let mut bad_signature = signed_package(&signer, 512);
    bad_signature.signature[0] ^= 1;

    let mut rollback = signed_package(&signer, 512);
    rollback.manifest.rollback_counter = 0;
    resign(&mut rollback, &signer);

    let mut downgrade = signed_package(&signer, 512);
    downgrade.manifest.firmware_version = "0.9.0".into();
    resign(&mut downgrade, &signer);

    for (package, category) in [
        (wrong_product, ErrorCategory::WrongProduct),
        (wrong_hardware, ErrorCategory::UnsupportedHardwareRevision),
        (bad_signature, ErrorCategory::SignatureInvalid),
        (rollback, ErrorCategory::RollbackRejected),
        (downgrade, ErrorCategory::DowngradeRejected),
    ] {
        let mut engine = engine(simulator(&signer));
        let err = engine
            .run(
                "sim-0001",
                &package,
                &signer.public_key(),
                UpdatePolicy::default(),
                |_| {},
            )
            .unwrap_err();
        assert_eq!(err.category(), category);
        let simulator = engine.into_connector().shutdown();
        assert!(simulator.info().candidate_slot.is_none());
        assert_eq!(simulator.info().firmware_version, "1.0.0");
    }
}

#[test]
fn a_clean_run_reports_no_resumed_connections() {
    let signer = SigningIdentity::from_seed("release", [0x71; 32]);
    let package = signed_package(&signer, 3072);
    let mut engine = engine(simulator(&signer));
    let report = engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap();
    assert_eq!(report.resumed_connections, 0);
    assert!(report.duration_ms > 0);
    let _ = engine.into_connector().shutdown();
}
