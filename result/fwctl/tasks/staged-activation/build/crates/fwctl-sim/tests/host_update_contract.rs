use std::time::Duration;

use fwctl_core::crypto::{
    SigningIdentity, TrustStore, manifest_signing_message, verify_manifest_signature,
};
use fwctl_core::device::{DeviceInfo, Slot, UpdateId, UpdateState as DeviceState};
use fwctl_core::history::{HistoryRecord, HistoryResult, HistoryStore};
use fwctl_core::package::{
    FIRMWARE_ENTRY, FirmwareManifest, FirmwarePackage, ImageDigest, digest_bytes,
};
use fwctl_core::protocol::{
    Frame, MAX_FRAME_PAYLOAD, MessageKind, PROTOCOL_VERSION, ProtocolMessage,
};
use fwctl_core::update::{UpdateEngine, UpdatePolicy, UpdateState};
use fwctl_core::{Config, ErrorCategory, FwctlError};
use fwctl_sim::{Simulator, SimulatorConfig, SimulatorConnector, SimulatorTrustedKey};

fn scratch(name: &str) -> std::path::PathBuf {
    let unique = format!(
        "fwctl-base-{}-{}-{}",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let dir = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn package(signer: &SigningIdentity, version: &str, counter: u64, len: usize) -> FirmwarePackage {
    let image = (0..len)
        .map(|offset| u8::try_from((offset * 3 + version.len()) % 251).unwrap())
        .collect::<Vec<_>>();
    let manifest = FirmwareManifest::new(
        "sensor-node".into(),
        version.into(),
        vec!["A1".into()],
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

fn simulator(signer: &SigningIdentity) -> Simulator {
    Simulator::new(SimulatorConfig {
        trusted_keys: vec![SimulatorTrustedKey {
            key_id: signer.key_id().into(),
            public_key: signer.public_key().to_bytes(),
        }],
        ..SimulatorConfig::default()
    })
    .unwrap()
}

fn engine(simulator: Simulator) -> UpdateEngine<SimulatorConnector> {
    UpdateEngine::new(
        SimulatorConnector::new(simulator),
        Duration::from_millis(50),
        Duration::from_secs(1),
        512,
    )
}

fn device() -> DeviceInfo {
    DeviceInfo {
        device_id: "board-4".into(),
        product: "sensor-node".into(),
        hardware_revision: "A1".into(),
        firmware_version: "1.0.0".into(),
        bootloader_version: "0.6.0".into(),
        active_slot: Slot::A,
        candidate_slot: None,
        rollback_counter: 1,
        update_state: DeviceState::Idle,
    }
}

// ---- package and manifest ------------------------------------------------

#[test]
fn manifest_names_the_only_image_entry() {
    let signer = SigningIdentity::from_seed("release", [1; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    assert_eq!(package.manifest.image.file, FIRMWARE_ENTRY);
}

#[test]
fn the_canonical_manifest_encoding_is_stable() {
    let signer = SigningIdentity::from_seed("release", [2; 32]);
    let manifest = package(&signer, "1.1.0", 2, 512).manifest;
    let first = manifest.canonical_bytes().unwrap();
    assert_eq!(first, manifest.canonical_bytes().unwrap());
    let text = String::from_utf8(first).unwrap();
    assert!(text.contains("sensor-node"));
    assert!(text.contains("1.1.0"));
}

#[test]
fn manifest_rejects_a_duplicate_hardware_revision() {
    let signer = SigningIdentity::from_seed("release", [3; 32]);
    let mut manifest = package(&signer, "1.1.0", 2, 512).manifest;
    manifest.hardware_revisions.push("A1".into());
    assert!(manifest.validate().is_err());
}

#[test]
fn manifest_rejects_an_empty_hardware_list() {
    let signer = SigningIdentity::from_seed("release", [4; 32]);
    let mut manifest = package(&signer, "1.1.0", 2, 512).manifest;
    manifest.hardware_revisions.clear();
    assert!(manifest.validate().is_err());
}

#[test]
fn manifest_rejects_a_non_semantic_version() {
    let signer = SigningIdentity::from_seed("release", [5; 32]);
    let mut manifest = package(&signer, "1.1.0", 2, 512).manifest;
    manifest.firmware_version = "autumn-release".into();
    assert!(manifest.validate().is_err());
}

#[test]
fn manifest_rejects_a_path_like_image_name() {
    let signer = SigningIdentity::from_seed("release", [6; 32]);
    let mut manifest = package(&signer, "1.1.0", 2, 512).manifest;
    manifest.image.file = "../firmware.bin".into();
    assert!(manifest.validate().is_err());
}

#[test]
fn manifest_rejects_a_zero_length_image() {
    let signer = SigningIdentity::from_seed("release", [7; 32]);
    let mut manifest = package(&signer, "1.1.0", 2, 512).manifest;
    manifest.image.size = 0;
    assert!(manifest.validate().is_err());
}

#[test]
fn package_digest_matches_the_declared_image_hash() {
    let signer = SigningIdentity::from_seed("release", [8; 32]);
    let package = package(&signer, "1.1.0", 2, 777);
    assert_eq!(package.image_digest(), package.manifest.image.sha256);
}

#[test]
fn an_image_digest_reads_back_only_from_lowercase_hex() {
    let digest = digest_bytes(b"payload");
    let hex = digest.to_hex();
    assert_eq!(hex.len(), 64);
    assert_eq!(hex.parse::<ImageDigest>().unwrap(), digest);
    assert!(hex.to_uppercase().parse::<ImageDigest>().is_err());
    assert!("ab".parse::<ImageDigest>().is_err());
}

#[test]
fn the_signing_message_covers_the_fields_a_device_checks() {
    let signer = SigningIdentity::from_seed("release", [36; 32]);
    let manifest = package(&signer, "1.1.0", 2, 512).manifest;
    let message = manifest_signing_message(&manifest).unwrap();
    let mut moved = manifest.clone();
    moved.rollback_counter += 1;
    assert_ne!(message, manifest_signing_message(&moved).unwrap());
}

// ---- signing -------------------------------------------------------------

#[test]
fn a_manifest_signature_verifies_against_its_own_key() {
    let signer = SigningIdentity::from_seed("release", [9; 32]);
    let package = package(&signer, "1.1.0", 2, 256);
    assert!(
        verify_manifest_signature(&package.manifest, &package.signature, &signer.public_key())
            .is_ok()
    );
}

#[test]
fn a_manifest_signature_fails_against_another_key() {
    let signer = SigningIdentity::from_seed("release", [10; 32]);
    let other = SigningIdentity::from_seed("release", [11; 32]);
    let package = package(&signer, "1.1.0", 2, 256);
    assert!(matches!(
        verify_manifest_signature(&package.manifest, &package.signature, &other.public_key()),
        Err(FwctlError::SignatureInvalid)
    ));
}

#[test]
fn editing_the_manifest_breaks_its_signature() {
    let signer = SigningIdentity::from_seed("release", [12; 32]);
    let mut package = package(&signer, "1.1.0", 2, 256);
    package.manifest.rollback_counter += 1;
    assert!(matches!(
        verify_manifest_signature(&package.manifest, &package.signature, &signer.public_key()),
        Err(FwctlError::SignatureInvalid)
    ));
}

#[test]
fn a_trust_store_round_trips_a_public_key() {
    let root = scratch("trust").join("keys");
    let signer = SigningIdentity::from_seed("release", [13; 32]);
    let source = root.parent().unwrap().join("release.pub");
    std::fs::create_dir_all(root.parent().unwrap()).unwrap();
    std::fs::write(&source, signer.public_key().to_bytes()).unwrap();
    let store = TrustStore::new(&root);
    store.add(&source, "release").unwrap();
    assert_eq!(
        store.load("release").unwrap().to_bytes(),
        signer.public_key().to_bytes()
    );
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn an_unknown_signing_key_is_reported_as_untrusted() {
    let root = scratch("trust-missing").join("keys");
    let err = TrustStore::new(&root).load("release").unwrap_err();
    assert!(matches!(err, FwctlError::UnknownSigningKey(_)));
}

// ---- policy --------------------------------------------------------------

#[test]
fn policy_accepts_a_signed_compatible_upgrade() {
    let signer = SigningIdentity::from_seed("release", [14; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    let plan = UpdatePolicy::default()
        .evaluate(&package, &signer.public_key(), &device())
        .unwrap();
    assert_eq!(plan.target_slot, Slot::B);
    assert_eq!(plan.new_version, "1.1.0");
    assert_eq!(plan.old_version, "1.0.0");
    assert_eq!(plan.image_size, 512);
}

#[test]
fn policy_targets_the_slot_the_device_is_not_running() {
    let signer = SigningIdentity::from_seed("release", [15; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    let mut info = device();
    info.active_slot = Slot::B;
    let plan = UpdatePolicy::default()
        .evaluate(&package, &signer.public_key(), &info)
        .unwrap();
    assert_eq!(plan.target_slot, Slot::A);
}

#[test]
fn policy_refuses_another_product() {
    let signer = SigningIdentity::from_seed("release", [16; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    let mut info = device();
    info.product = "gateway".into();
    assert!(matches!(
        UpdatePolicy::default().evaluate(&package, &signer.public_key(), &info),
        Err(FwctlError::WrongProduct { .. })
    ));
}

#[test]
fn policy_refuses_an_unlisted_hardware_revision() {
    let signer = SigningIdentity::from_seed("release", [17; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    let mut info = device();
    info.hardware_revision = "C9".into();
    assert!(matches!(
        UpdatePolicy::default().evaluate(&package, &signer.public_key(), &info),
        Err(FwctlError::UnsupportedHardwareRevision(_))
    ));
}

#[test]
fn policy_refuses_a_downgrade_by_default() {
    let signer = SigningIdentity::from_seed("release", [18; 32]);
    let package = package(&signer, "0.9.0", 2, 512);
    assert!(matches!(
        UpdatePolicy::default().evaluate(&package, &signer.public_key(), &device()),
        Err(FwctlError::DowngradeRejected { .. })
    ));
}

#[test]
fn an_explicit_policy_allows_a_downgrade() {
    let signer = SigningIdentity::from_seed("release", [19; 32]);
    let package = package(&signer, "0.9.0", 2, 512);
    assert!(
        UpdatePolicy {
            allow_downgrade: true
        }
        .evaluate(&package, &signer.public_key(), &device())
        .is_ok()
    );
}

#[test]
fn a_permitted_downgrade_still_obeys_the_rollback_counter() {
    let signer = SigningIdentity::from_seed("release", [20; 32]);
    let package = package(&signer, "0.9.0", 0, 512);
    assert!(matches!(
        UpdatePolicy {
            allow_downgrade: true
        }
        .evaluate(&package, &signer.public_key(), &device()),
        Err(FwctlError::RollbackRejected { .. })
    ));
}

#[test]
fn policy_refuses_a_package_signed_by_another_key() {
    let signer = SigningIdentity::from_seed("release", [21; 32]);
    let other = SigningIdentity::from_seed("release", [22; 32]);
    let package = package(&signer, "1.1.0", 2, 512);
    assert!(matches!(
        UpdatePolicy::default().evaluate(&package, &other.public_key(), &device()),
        Err(FwctlError::SignatureInvalid)
    ));
}

// ---- device model --------------------------------------------------------

#[test]
fn slots_are_symmetric() {
    assert_eq!(Slot::A.inactive(), Slot::B);
    assert_eq!(Slot::B.inactive(), Slot::A);
}

#[test]
fn device_info_accepts_a_consistent_report() {
    assert!(device().validate().is_ok());
}

#[test]
fn a_candidate_in_the_active_slot_is_refused() {
    let mut info = device();
    info.candidate_slot = Some(Slot::A);
    assert!(matches!(
        info.validate(),
        Err(FwctlError::ProtocolMismatch(_))
    ));
}

#[test]
fn a_device_version_that_is_not_semantic_is_refused() {
    let mut info = device();
    info.firmware_version = "rolling".into();
    assert!(info.validate().is_err());
}

#[test]
fn an_update_id_prints_as_fixed_width_hex() {
    assert_eq!(UpdateId::from_bytes([0xa5; 16]).to_string().len(), 32);
}

// ---- protocol framing ----------------------------------------------------

#[test]
fn a_frame_round_trips_through_its_encoding() {
    let frame = Frame::new(MessageKind::GetStatus, 9, Vec::new()).unwrap();
    let decoded = Frame::decode(&frame.encode().unwrap()).unwrap();
    assert_eq!(decoded.kind, MessageKind::GetStatus);
    assert_eq!(decoded.sequence, 9);
}

#[test]
fn a_frame_rejects_a_corrupted_byte() {
    let frame = Frame::new(MessageKind::GetInfo, 3, Vec::new()).unwrap();
    let mut bytes = frame.encode().unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    assert!(Frame::decode(&bytes).is_err());
}

#[test]
fn a_frame_rejects_an_oversized_payload() {
    assert!(Frame::new(MessageKind::WriteChunk, 1, vec![0; MAX_FRAME_PAYLOAD + 1]).is_err());
}

#[test]
fn the_protocol_version_is_one() {
    assert_eq!(PROTOCOL_VERSION, 1);
}

#[test]
fn hello_round_trips_as_a_message() {
    let message = ProtocolMessage::Hello { host_nonce: 0x4142 };
    let frame = message.clone().into_frame(1).unwrap();
    assert_eq!(ProtocolMessage::from_frame(&frame).unwrap(), message);
}

#[test]
fn a_write_chunk_round_trips_with_its_payload() {
    let message = ProtocolMessage::WriteChunk {
        update_id: UpdateId::from_bytes([4; 16]),
        offset: 2048,
        data: vec![0xab; 512],
    };
    let frame = message.clone().into_frame(7).unwrap();
    assert_eq!(ProtocolMessage::from_frame(&frame).unwrap(), message);
}

#[test]
fn an_error_message_round_trips_with_its_text() {
    let message = ProtocolMessage::Error {
        code: 12,
        message: "flash busy".into(),
    };
    let frame = message.clone().into_frame(2).unwrap();
    assert_eq!(ProtocolMessage::from_frame(&frame).unwrap(), message);
}

#[test]
fn every_message_reports_its_own_kind() {
    assert_eq!(ProtocolMessage::GetInfo.kind(), MessageKind::GetInfo);
    assert_eq!(ProtocolMessage::Reboot.kind(), MessageKind::Reboot);
    assert_eq!(
        ProtocolMessage::ConfirmBootResponse.kind(),
        MessageKind::ConfirmBootResp
    );
}

// ---- configuration -------------------------------------------------------

#[test]
fn configuration_defaults_match_the_documented_transport_policy() {
    let config = Config::default();
    assert_eq!(config.default_timeout, Duration::from_secs(5));
    assert_eq!(config.reconnect_timeout, Duration::from_secs(20));
    assert_eq!(config.chunk_size, 1024);
}

#[test]
fn a_chunk_size_below_the_floor_is_refused() {
    let config = Config {
        chunk_size: 64,
        ..Config::default()
    };
    assert!(matches!(
        config.validate(),
        Err(FwctlError::Configuration(_))
    ));
}

#[test]
fn a_reconnect_timeout_shorter_than_the_request_timeout_is_refused() {
    let config = Config {
        default_timeout: Duration::from_secs(9),
        reconnect_timeout: Duration::from_secs(2),
        ..Config::default()
    };
    assert!(config.validate().is_err());
}

#[test]
fn an_unknown_configuration_key_is_refused() {
    let path = scratch("config-unknown").join("config.toml");
    std::fs::write(&path, "serial_baud = 115200\n").unwrap();
    assert!(matches!(
        Config::load(Some(&path)),
        Err(FwctlError::Configuration(_))
    ));
}

#[test]
fn relative_trust_and_history_paths_follow_the_config_file() {
    let dir = scratch("config-relative");
    let path = dir.join("fwctl.toml");
    std::fs::write(
        &path,
        "default_timeout = \"3s\"\nreconnect_timeout = \"15s\"\nchunk_size = 2048\n\
         trust_store = \"release-keys\"\nhistory_file = \"state/history.jsonl\"\n",
    )
    .unwrap();
    let config = Config::load(Some(&path)).unwrap();
    assert_eq!(config.trust_store, dir.join("release-keys"));
    assert_eq!(config.history_file, dir.join("state/history.jsonl"));
}

// ---- history -------------------------------------------------------------

fn history_record(device_id: &str, version: &str) -> HistoryRecord {
    HistoryRecord {
        timestamp: "2021-03-15T10:00:00Z".into(),
        device_id: device_id.into(),
        product: "sensor-node".into(),
        old_version: "1.0.0".into(),
        new_version: version.into(),
        package_hash: "cd".repeat(32),
        signing_key: "release".into(),
        result: HistoryResult::Completed,
        duration_ms: 1200,
        rollback_result: None,
        error_category: None,
    }
}

#[test]
fn history_filters_by_device() {
    let store = HistoryStore::new(scratch("history-filter").join("history.jsonl"));
    store.append(&history_record("board-a", "1.1.0")).unwrap();
    store.append(&history_record("board-b", "1.2.0")).unwrap();
    store.append(&history_record("board-a", "1.3.0")).unwrap();
    let records = store.read(Some("board-a"), 20).unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].new_version, "1.3.0");
}

#[test]
fn history_returns_only_the_newest_entries() {
    let store = HistoryStore::new(scratch("history-limit").join("history.jsonl"));
    store.append(&history_record("board", "1.1.0")).unwrap();
    store.append(&history_record("board", "1.2.0")).unwrap();
    assert_eq!(store.read(None, 1).unwrap()[0].new_version, "1.2.0");
}

#[test]
fn a_corrupt_history_line_is_reported_with_its_number() {
    let path = scratch("history-corrupt").join("history.jsonl");
    std::fs::write(&path, "{broken}\n").unwrap();
    let err = HistoryStore::new(path).read(None, 10).unwrap_err();
    assert!(err.to_string().contains("line 1"));
}

#[test]
fn an_absent_history_file_reads_as_empty() {
    let store = HistoryStore::new(scratch("history-absent").join("history.jsonl"));
    assert!(store.read(None, 10).unwrap().is_empty());
}

// ---- error categories ----------------------------------------------------

#[test]
fn errors_carry_the_category_the_command_line_maps_to_an_exit_code() {
    assert_eq!(
        FwctlError::SignatureInvalid.category(),
        ErrorCategory::SignatureInvalid
    );
    assert_eq!(
        FwctlError::HealthCheckFailed.category(),
        ErrorCategory::HealthCheckFailed
    );
    assert_eq!(
        FwctlError::DeviceNotFound("board".into()).category(),
        ErrorCategory::DeviceNotFound
    );
}

// ---- end to end through the simulator ------------------------------------

#[test]
fn a_direct_update_completes_and_advances_the_counter() {
    let signer = SigningIdentity::from_seed("release", [30; 32]);
    let package = package(&signer, "1.1.0", 2, 4000);
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
    assert_eq!(report.state, UpdateState::Completed);
    assert_eq!(report.target_slot, Slot::B);
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.1.0");
    assert_eq!(simulator.info().rollback_counter, 2);
}

#[test]
fn a_direct_update_resumes_after_a_disconnect() {
    let signer = SigningIdentity::from_seed("release", [31; 32]);
    let package = package(&signer, "1.1.0", 2, 4096);
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
fn a_digest_mismatch_never_reaches_the_candidate_state() {
    let signer = SigningIdentity::from_seed("release", [32; 32]);
    let package = package(&signer, "1.1.0", 2, 2048);
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
fn an_unhealthy_candidate_is_never_confirmed() {
    let signer = SigningIdentity::from_seed("release", [33; 32]);
    let package = package(&signer, "1.1.0", 2, 1024);
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
    assert_eq!(simulator.info().rollback_counter, 1);
    assert!(simulator.info().candidate_slot.is_some());
}

#[test]
fn an_unknown_device_id_is_not_updated() {
    let signer = SigningIdentity::from_seed("release", [34; 32]);
    let package = package(&signer, "1.1.0", 2, 1024);
    let mut engine = engine(simulator(&signer));
    let err = engine
        .run(
            "rack-9",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::RebootTimeout | FwctlError::DeviceNotFound(_)));
    let _ = engine.into_connector().shutdown();
}

#[test]
fn an_update_reports_the_states_it_passed_through() {
    let signer = SigningIdentity::from_seed("release", [35; 32]);
    let package = package(&signer, "1.1.0", 2, 2048);
    let mut engine = engine(simulator(&signer));
    let mut states = Vec::new();
    engine
        .run(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            |event| states.push(event.state),
        )
        .unwrap();
    for expected in [
        UpdateState::Connected,
        UpdateState::Validated,
        UpdateState::Erasing,
        UpdateState::Transferring,
        UpdateState::Verifying,
        UpdateState::CandidateSet,
        UpdateState::Confirming,
        UpdateState::Completed,
    ] {
        assert!(states.contains(&expected), "missing state {expected:?}");
    }
    let _ = engine.into_connector().shutdown();
}
