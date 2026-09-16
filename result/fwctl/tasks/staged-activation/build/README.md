# fwctl

`fwctl` is a firmware-delivery system for Linux hosts and embedded Rust devices.
It creates signed `.fwpkg` archives, discovers devices over USB serial, applies
compatibility and rollback policy, resumes interrupted transfers, and activates
firmware through health-gated A/B slots.

fwctl deliberately has no network service or fleet layer. Trust remains local:
the host checks a configured Ed25519 trust store, and the device verifies the
signed release authorization independently before allowing flash mutation.

## Safety model

- The package contains canonical `manifest.json`, `firmware.bin`, and a detached
  Ed25519 signature. An optional UTF-8 release-notes file is bounded to 256 KiB.
- Archive names, decompressed sizes, image size, and SHA-256 are validated before
  policy evaluation.
- Product, hardware revision, semantic version, and monotonic rollback counter
  are checked before transfer.
- Frames carry protocol version, message kind, sequence number, bounded payload
  length, and CRC-32. Requests use finite timeouts and retries.
- The device erases and programs only the inactive slot. Transfer checkpoints and
  boot state are stored in alternating CRC-protected metadata sectors.
- A candidate receives two boot attempts. It becomes confirmed only after core,
  update protocol, and application health are ready; otherwise boot returns to
  the last confirmed slot.

## Build

Rust 1.96 or newer is required.

```sh
cargo build --release -p fwctl
./target/release/fwctl version
```

The reusable device library supports `no_std`:

```sh
cargo check -p fwctl-device --no-default-features
```

## Package and trust workflow

Signing keys are 32-byte Ed25519 seeds, either raw or hex encoded. Keep private
keys outside the repository with mode `0600`. Public keys may be raw or hex.

```sh
fwctl package \
  --product sensor-node \
  --version 1.2.0 \
  --hardware A1,A2 \
  --rollback-counter 4 \
  --image target/thumbv8m.main-none-eabihf/release/app.bin \
  --key ~/.config/fwctl/release.key \
  --output sensor-node-1.2.0.fwpkg

fwctl inspect sensor-node-1.2.0.fwpkg
fwctl keys add release.pub --id release
fwctl verify sensor-node-1.2.0.fwpkg
fwctl devices
fwctl --device sensor-0042 update sensor-node-1.2.0.fwpkg
fwctl --device sensor-0042 status
```

After an update, run `fwctl --device sensor-0042 history` to review the outcome
recorded locally, or `fwctl doctor` if a device does not show up in `fwctl
devices`.

Every command accepts `--json`; progress remains on standard error so standard
output is a single machine-readable record. `--quiet` suppresses successful human
output, while `--verbose` reports configuration and connection detail.

## Configuration

The default configuration is `$XDG_CONFIG_HOME/fwctl/config.toml`. Relative trust
and history paths are resolved from the configuration file's directory.

```toml
default_timeout = "5s"
reconnect_timeout = "20s"
chunk_size = 1024
trust_store = "keys"
history_file = "state/history.jsonl"
```

Chunk size must be 256–16384 bytes and reconnect timeout cannot be shorter than
the request timeout. `fwctl doctor` checks configuration directories, serial
access, and trust-store readiness.

## Commands

| Command | Purpose |
|---|---|
| `version` | Print the host tool version |
| `devices`, `info` | Discover targets and read immutable identity/state |
| `package`, `inspect`, `verify` | Create and authenticate `.fwpkg` archives |
| `update` | Validate, transfer, activate, health-check, and confirm |
| `status`, `confirm`, `rollback` | Inspect or recover candidate boot state |
| `history` | Query bounded local JSONL update records |
| `doctor` | Diagnose configuration and host prerequisites |
| `keys list/add/remove` | Administer trusted release keys |

The supported reference targets are Raspberry Pi Pico 2 and ESP-IDF-compatible
ESP32 boards with 4 MiB flash. Their partition maps and bring-up contracts are
documented in [`boards/reference-board/README.md`](boards/reference-board/README.md)
and [`boards/esp32-reference/README.md`](boards/esp32-reference/README.md).

## Development

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo check -p fwctl-device --no-default-features
```

The simulator executes the same host update engine and device updater used by
the serial and embedded paths. Integration tests cover disconnect/resume, flash
failure, digest mismatch, untrusted device keys, unhealthy candidates, reboot
loss, confirmation, and automatic rollback.

Licensed under the MIT license.
