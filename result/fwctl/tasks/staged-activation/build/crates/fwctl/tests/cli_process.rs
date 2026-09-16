use std::fs;
use std::process::{Command, Output};

use fwctl_core::crypto::SigningIdentity;

fn fwctl(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_fwctl"))
        .args(args)
        .output()
        .expect("fwctl process should start")
}

#[test]
fn version_supports_human_and_machine_output() {
    let human = fwctl(&["version"]);
    assert!(human.status.success());
    assert_eq!(
        String::from_utf8(human.stdout).unwrap(),
        format!("fwctl {}\n", env!("CARGO_PKG_VERSION"))
    );
    assert!(human.stderr.is_empty());

    let machine = fwctl(&["--json", "version"]);
    assert!(machine.status.success());
    let value: serde_json::Value = serde_json::from_slice(&machine.stdout).unwrap();
    assert_eq!(value["program"], "fwctl");
    assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
    assert!(machine.stderr.is_empty());
}

#[test]
fn quiet_mode_suppresses_success_output() {
    let output = fwctl(&["--quiet", "version"]);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#[test]
fn clap_rejects_conflicting_global_flags() {
    let output = fwctl(&["--quiet", "--verbose", "version"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("cannot be used with")
    );
}

#[test]
fn configuration_failures_have_stable_json_and_exit_code() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("invalid.toml");
    fs::write(&config, "chunk_size = 12\n").unwrap();
    let config = config.to_str().unwrap();

    let output = fwctl(&["--json", "--config", config, "version"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stderr.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], false);
    assert_eq!(value["category"], "configuration");
    assert!(value["error"].as_str().unwrap().contains("chunk_size"));

    let human = fwctl(&["--config", config, "version"]);
    assert_eq!(human.status.code(), Some(2));
    assert!(human.stdout.is_empty());
    assert!(
        String::from_utf8(human.stderr)
            .unwrap()
            .starts_with("error: configuration error:")
    );
}

#[test]
fn package_key_and_verification_commands_interoperate() {
    let dir = tempfile::tempdir().unwrap();
    let image = dir.path().join("controller.bin");
    let private_key = dir.path().join("release.key");
    let public_key = dir.path().join("release.pub");
    let package = dir.path().join("controller.fwpkg");
    let config = dir.path().join("fwctl.toml");
    let trust_store = dir.path().join("trusted-keys");
    let history = dir.path().join("history.jsonl");
    let seed = [0x73; 32];
    fs::write(&image, (0..=255).collect::<Vec<_>>()).unwrap();
    fs::write(&private_key, seed).unwrap();
    fs::write(
        &public_key,
        SigningIdentity::from_seed("release", seed)
            .public_key()
            .to_bytes(),
    )
    .unwrap();
    fs::write(
        &config,
        format!("trust_store = {trust_store:?}\nhistory_file = {history:?}\n"),
    )
    .unwrap();

    let created = fwctl(&[
        "--json",
        "package",
        "--product",
        "controller",
        "--version",
        "2.4.0",
        "--hardware",
        "rev-b,rev-c",
        "--rollback-counter",
        "9",
        "--image",
        image.to_str().unwrap(),
        "--key",
        private_key.to_str().unwrap(),
        "--output",
        package.to_str().unwrap(),
    ]);
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    let created: serde_json::Value = serde_json::from_slice(&created.stdout).unwrap();
    assert_eq!(created["firmware_version"], "2.4.0");
    assert_eq!(created["image_size"], 256);

    let inspected = fwctl(&["--json", "inspect", package.to_str().unwrap()]);
    assert!(inspected.status.success());
    let inspected: serde_json::Value = serde_json::from_slice(&inspected.stdout).unwrap();
    assert_eq!(inspected["product"], "controller");
    assert_eq!(
        inspected["hardware_revisions"],
        serde_json::json!(["rev-b", "rev-c"])
    );
    assert_eq!(inspected["rollback_counter"], 9);

    exercise_trust_commands(
        config.to_str().unwrap(),
        public_key.to_str().unwrap(),
        package.to_str().unwrap(),
    );
}

fn exercise_trust_commands(config: &str, public_key: &str, package: &str) {
    let added = fwctl(&[
        "--json", "--config", config, "keys", "add", public_key, "--id", "release",
    ]);
    assert!(added.status.success());

    let listed = fwctl(&["--json", "--config", config, "keys", "list"]);
    assert!(listed.status.success());
    let listed: serde_json::Value = serde_json::from_slice(&listed.stdout).unwrap();
    assert_eq!(listed["keys"][0]["key_id"], "release");

    let verified = fwctl(&["--json", "--config", config, "verify", package]);
    assert!(
        verified.status.success(),
        "{}",
        String::from_utf8_lossy(&verified.stderr)
    );
    let verified: serde_json::Value = serde_json::from_slice(&verified.stdout).unwrap();
    assert_eq!(verified["verified"], true);
    assert_eq!(verified["signing_key"], "release");

    let removed = fwctl(&["--json", "--config", config, "keys", "remove", "release"]);
    assert!(removed.status.success());
    let rejected = fwctl(&["--json", "--config", config, "verify", package]);
    assert_eq!(rejected.status.code(), Some(3));
    let rejected: serde_json::Value = serde_json::from_slice(&rejected.stdout).unwrap();
    assert_eq!(rejected["category"], "unknown_signing_key");
}
