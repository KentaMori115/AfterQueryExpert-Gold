use std::time::Duration;

use fwctl_core::crypto::SigningIdentity;
use fwctl_core::device::Slot;
use fwctl_core::package::{FirmwareManifest, FirmwarePackage, digest_bytes};
use fwctl_core::update::{
    StagedUpdate, StagingJournal, UpdateEngine, UpdatePolicy, UpdateState,
};
use fwctl_core::{Config, ErrorCategory, FwctlError};
use fwctl_sim::{Simulator, SimulatorConfig, SimulatorConnector, SimulatorTrustedKey};

fn scratch(name: &str) -> std::path::PathBuf {
    let unique = format!(
        "fwctl-{}-{}-{:?}",
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
    let seed: usize = version.bytes().map(usize::from).sum();
    let image = (0..len)
        .map(|offset| u8::try_from((offset * 7 + seed) % 251).unwrap())
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

fn simulator(signer: &SigningIdentity, device_id: &str) -> Simulator {
    Simulator::new(SimulatorConfig {
        device_id: device_id.into(),
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

fn journal(name: &str) -> StagingJournal {
    StagingJournal::new(scratch(name).join("staged.jsonl"))
}

#[test]
fn staging_leaves_the_device_on_its_confirmed_firmware() {
    let signer = SigningIdentity::from_seed("release", [0x11; 32]);
    let package = package(&signer, "1.1.0", 2, 3000);
    let journal = journal("stage-confirmed");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    engine
        .stage(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    assert_eq!(engine.state(), UpdateState::Staged);
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.0.0");
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn staging_announces_the_staged_state_to_the_observer() {
    let signer = SigningIdentity::from_seed("release", [0x12; 32]);
    let package = package(&signer, "1.1.0", 2, 1500);
    let journal = journal("stage-observer");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let mut states = Vec::new();
    engine
        .stage(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |event| states.push(event.state),
        )
        .unwrap();
    assert!(states.contains(&UpdateState::Verifying));
    assert_eq!(states.last(), Some(&UpdateState::Staged));
    assert!(!states.contains(&UpdateState::CandidateSet));
    let _ = engine.into_connector().shutdown();
}

#[test]
fn staging_writes_the_record_the_activation_will_need() {
    let signer = SigningIdentity::from_seed("release", [0x13; 32]);
    let package = package(&signer, "1.1.0", 2, 2048);
    let journal = journal("stage-record");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let returned = engine
        .stage(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    let held = journal.get("sim-0001").unwrap().unwrap();
    assert_eq!(held.update_id, returned.update_id);
    assert_eq!(held.staged_at, returned.staged_at);
    assert_eq!(held.device_id, "sim-0001");
    assert_eq!(held.product, "sensor-node");
    assert_eq!(held.old_version, "1.0.0");
    assert_eq!(held.new_version, "1.1.0");
    assert_eq!(held.target_slot, Slot::B);
    assert_eq!(held.image_size, 2048);
    assert_eq!(held.image_digest, digest_bytes(&package.image));
    assert_eq!(held.rollback_counter, 2);
    assert!(!held.allow_downgrade);
    assert_eq!(held.signing_key, "release");
    assert!(!held.staged_at.is_empty());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn staging_again_replaces_the_record_for_that_device() {
    let signer = SigningIdentity::from_seed("release", [0x14; 32]);
    let journal = journal("stage-replace");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    for version in ["1.1.0", "1.2.0"] {
        engine
            .stage(
                "sim-0001",
                &package(&signer, version, 2, 1024),
                &signer.public_key(),
                UpdatePolicy::default(),
                &journal,
                |_| {},
            )
            .unwrap();
    }
    assert_eq!(journal.list().unwrap().len(), 1);
    assert_eq!(journal.get("sim-0001").unwrap().unwrap().new_version, "1.2.0");
    let _ = engine.into_connector().shutdown();
}

#[test]
fn staging_the_same_image_again_continues_the_transfer() {
    let signer = SigningIdentity::from_seed("release", [0x1b; 32]);
    let package = package(&signer, "1.1.0", 2, 3072);
    let journal = journal("stage-continue");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    engine
        .stage(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    let first = journal.get("sim-0001").unwrap().unwrap();
    let mut states = Vec::new();
    engine
        .stage(
            "sim-0001",
            &package,
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |event| states.push(event.state),
        )
        .unwrap();
    let second = journal.get("sim-0001").unwrap().unwrap();
    assert_eq!(second.update_id, first.update_id);
    assert!(!states.contains(&UpdateState::Erasing));
    let _ = engine.into_connector().shutdown();
}

#[test]
fn staging_another_image_starts_a_new_transfer() {
    let signer = SigningIdentity::from_seed("release", [0x1c; 32]);
    let journal = journal("stage-restart");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    engine
        .stage(
            "sim-0001",
            &package(&signer, "1.1.0", 2, 3072),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    let first = journal.get("sim-0001").unwrap().unwrap();
    let mut states = Vec::new();
    engine
        .stage(
            "sim-0001",
            &package(&signer, "1.2.0", 2, 3072),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |event| states.push(event.state),
        )
        .unwrap();
    let second = journal.get("sim-0001").unwrap().unwrap();
    assert_ne!(second.update_id, first.update_id);
    assert_eq!(second.new_version, "1.2.0");
    let _ = engine.into_connector().shutdown();
}

#[test]
fn one_journal_holds_a_record_for_each_device() {
    let signer = SigningIdentity::from_seed("release", [0x15; 32]);
    let journal = journal("stage-two-devices");
    for device_id in ["sim-0001", "sim-0002"] {
        let mut engine = engine(simulator(&signer, device_id));
        engine
            .stage(
                device_id,
                &package(&signer, "1.1.0", 2, 1024),
                &signer.public_key(),
                UpdatePolicy::default(),
                &journal,
                |_| {},
            )
            .unwrap();
        let _ = engine.into_connector().shutdown();
    }
    let mut devices: Vec<String> = journal
        .list()
        .unwrap()
        .into_iter()
        .map(|record| record.device_id)
        .collect();
    devices.sort();
    assert_eq!(devices, ["sim-0001", "sim-0002"]);
}

#[test]
fn staging_resumes_a_transfer_the_link_interrupted() {
    let signer = SigningIdentity::from_seed("release", [0x16; 32]);
    let mut simulator = simulator(&signer, "sim-0001");
    simulator.faults_mut().disconnect_at_chunk = Some(2);
    let journal = journal("stage-resume");
    let mut engine = engine(simulator);
    engine
        .stage(
            "sim-0001",
            &package(&signer, "1.1.0", 2, 4096),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    assert!(journal.get("sim-0001").unwrap().is_some());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn staging_applies_the_same_policy_as_a_direct_update() {
    let signer = SigningIdentity::from_seed("release", [0x17; 32]);
    let other = SigningIdentity::from_seed("release", [0x18; 32]);
    let journal = journal("stage-policy");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let err = engine
        .stage(
            "sim-0001",
            &package(&signer, "1.1.0", 2, 1024),
            &other.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::SignatureInvalid));
    assert!(journal.list().unwrap().is_empty());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_refused_downgrade_stages_nothing() {
    let signer = SigningIdentity::from_seed("release", [0x19; 32]);
    let journal = journal("stage-downgrade");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let err = engine
        .stage(
            "sim-0001",
            &package(&signer, "0.9.0", 2, 1024),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::DowngradeRejected { .. }));
    assert!(journal.get("sim-0001").unwrap().is_none());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_failed_verification_stages_nothing() {
    let signer = SigningIdentity::from_seed("release", [0x1a; 32]);
    let mut simulator = simulator(&signer, "sim-0001");
    simulator.faults_mut().force_verify_failure = true;
    let journal = journal("stage-verify");
    let mut engine = engine(simulator);
    let err = engine
        .stage(
            "sim-0001",
            &package(&signer, "1.1.0", 2, 1024),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap_err();
    assert!(matches!(err, FwctlError::ImageVerificationFailed));
    assert!(journal.list().unwrap().is_empty());
    let _ = engine.into_connector().shutdown();
}

fn stage_then(
    seed: u8,
    name: &str,
) -> (SigningIdentity, StagingJournal, Simulator, StagedUpdate) {
    let signer = SigningIdentity::from_seed("release", [seed; 32]);
    let journal = journal(name);
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let staged = engine
        .stage(
            "sim-0001",
            &package(&signer, "1.1.0", 2, 2048),
            &signer.public_key(),
            UpdatePolicy::default(),
            &journal,
            |_| {},
        )
        .unwrap();
    let simulator = engine.into_connector().shutdown();
    (signer, journal, simulator, staged)
}

#[test]
fn activation_boots_and_confirms_the_staged_image() {
    let (_signer, journal, simulator, _staged) = stage_then(0x21, "activate-ok");
    let mut engine = engine(simulator);
    let report = engine.activate("sim-0001", &journal, |_| {}).unwrap();
    assert_eq!(report.state, UpdateState::Completed);
    assert_eq!(report.device_id, "sim-0001");
    assert_eq!(report.old_version, "1.0.0");
    assert_eq!(report.new_version, "1.1.0");
    assert_eq!(report.target_slot, Slot::B);
    assert_eq!(report.image_size, 2048);
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.1.0");
    assert_eq!(simulator.info().rollback_counter, 2);
    assert!(journal.list().unwrap().is_empty());
}

#[test]
fn activation_with_nothing_staged_says_so() {
    let signer = SigningIdentity::from_seed("release", [0x22; 32]);
    let journal = journal("activate-empty");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::NothingStaged);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_second_activation_finds_nothing_staged() {
    let (_signer, journal, simulator, _staged) = stage_then(0x23, "activate-twice");
    let mut first = engine(simulator);
    first.activate("sim-0001", &journal, |_| {}).unwrap();
    let simulator = first.into_connector().shutdown();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::NothingStaged);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn activation_consumes_the_record_even_when_it_fails() {
    let (_signer, journal, mut simulator, _staged) = stage_then(0x24, "activate-consume");
    simulator.faults_mut().force_verify_failure = true;
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert!(matches!(err, FwctlError::ImageVerificationFailed));
    assert!(journal.list().unwrap().is_empty());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn activation_re_checks_the_image_on_the_device() {
    let (_signer, journal, mut simulator, _staged) = stage_then(0x25, "activate-digest");
    simulator.faults_mut().force_verify_failure = true;
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert!(matches!(err, FwctlError::ImageVerificationFailed));
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
    assert_eq!(simulator.info().firmware_version, "1.0.0");
}

#[test]
fn activation_still_refuses_an_unhealthy_candidate() {
    let (_signer, journal, mut simulator, _staged) = stage_then(0x26, "activate-health");
    simulator.faults_mut().candidate_healthy = false;
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert!(matches!(err, FwctlError::HealthCheckFailed));
    assert!(journal.list().unwrap().is_empty());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_record_naming_another_product_is_refused() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x31, "lost-product");
    staged.product = "gateway".into();
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::StagedUpdateLost);
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
    assert!(journal.list().unwrap().is_empty());
}

#[test]
fn a_record_the_device_version_has_passed_is_refused() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x32, "lost-version");
    staged.new_version = "0.9.0".into();
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::StagedUpdateLost);
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.0.0");
}

#[test]
fn a_downgrade_staged_with_permission_still_activates() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x37, "downgrade-ok");
    staged.new_version = "0.9.0".into();
    staged.allow_downgrade = true;
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let report = engine.activate("sim-0001", &journal, |_| {}).unwrap();
    assert_eq!(report.new_version, "0.9.0");
    assert_eq!(report.state, UpdateState::Completed);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_permitted_downgrade_is_recorded_as_permitted() {
    let signer = SigningIdentity::from_seed("release", [0x38; 32]);
    let journal = journal("stage-downgrade-flag");
    let mut engine = engine(simulator(&signer, "sim-0001"));
    engine
        .stage(
            "sim-0001",
            &package(&signer, "0.9.0", 2, 1024),
            &signer.public_key(),
            UpdatePolicy {
                allow_downgrade: true,
            },
            &journal,
            |_| {},
        )
        .unwrap();
    assert!(journal.get("sim-0001").unwrap().unwrap().allow_downgrade);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn activation_reports_the_firmware_the_device_is_leaving() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x39, "report-leaving");
    // What the device ran when this was staged is no longer a gate, so the
    // record can name something the device never ran and activation still goes
    // ahead. The report has to name what is actually being replaced.
    staged.old_version = "0.5.0".into();
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let report = engine.activate("sim-0001", &journal, |_| {}).unwrap();
    assert_eq!(report.old_version, "1.0.0");
    assert_eq!(report.new_version, "1.1.0");
    let simulator = engine.into_connector().shutdown();
    assert_eq!(simulator.info().firmware_version, "1.1.0");
}

#[test]
fn a_record_the_device_counter_has_passed_is_refused() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x33, "lost-counter");
    staged.rollback_counter = 0;
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::StagedUpdateLost);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_record_that_only_matches_the_device_counter_still_activates() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x36, "counter-equal");
    staged.rollback_counter = 1;
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let report = engine.activate("sim-0001", &journal, |_| {}).unwrap();
    assert_eq!(report.state, UpdateState::Completed);
    let _ = engine.into_connector().shutdown();
}

#[test]
fn a_record_naming_another_transfer_is_refused() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x34, "lost-update-id");
    staged.update_id = fwctl_core::device::UpdateId::from_bytes([0xfe; 16]);
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::StagedUpdateLost);
    let simulator = engine.into_connector().shutdown();
    assert!(simulator.info().candidate_slot.is_none());
}

#[test]
fn a_record_the_device_is_short_of_is_refused() {
    let (_signer, journal, simulator, mut staged) = stage_then(0x35, "lost-offset");
    // The device took every byte of the image it was sent. A record naming a
    // larger image is one the device is short of.
    staged.image_size = staged.image_size.saturating_add(512);
    journal.record(&staged).unwrap();
    let mut engine = engine(simulator);
    let err = engine.activate("sim-0001", &journal, |_| {}).unwrap_err();
    assert_eq!(err.category(), ErrorCategory::StagedUpdateLost);
    assert!(journal.list().unwrap().is_empty());
    let _ = engine.into_connector().shutdown();
}

#[test]
fn the_journal_path_is_configured_beside_the_other_state() {
    let dir = scratch("config");
    let path = dir.join("fwctl.toml");
    std::fs::write(
        &path,
        "default_timeout = \"3s\"\nreconnect_timeout = \"15s\"\nchunk_size = 1024\n\
         trust_store = \"keys\"\nhistory_file = \"state/history.jsonl\"\n\
         staging_file = \"state/staged.jsonl\"\n",
    )
    .unwrap();
    let config = Config::load(Some(&path)).unwrap();
    assert_eq!(config.staging_file, dir.join("state/staged.jsonl"));
}
