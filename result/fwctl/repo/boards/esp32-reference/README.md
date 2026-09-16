# ESP32 reference target

This target adds ESP-IDF-compatible ESP32 boards with at least 4 MiB of flash,
two OTA application partitions, and a UART or USB serial link. The reusable
adapter is `fwctl_device::boards::esp32`; the application supplies the small
ESP-IDF binding layer because the shared crate remains `no_std` and forbids
unsafe Rust.

This is an ESP-IDF integration, not an Arduino sketch or ArduinoOTA transport.
The device still speaks the fwctl serial protocol, so the host commands remain
`fwctl devices`, `fwctl info`, `fwctl update`, `fwctl status`, and `fwctl
rollback`.

## Flash map

The checked-in [`partitions.csv`](partitions.csv) is the source of truth for a
4 MiB device. It deliberately has no factory application: slot A is ESP-IDF
`ota_0` and slot B is `ota_1`.

| Region | Start | Length | fwctl use |
|---|---:|---:|---|
| NVS | `0x009000` | `0x004000` | ESP-IDF and provisioned identity |
| OTA selection | `0x00d000` | `0x002000` | Redundant ESP-IDF boot selection |
| PHY init | `0x00f000` | `0x001000` | ESP-IDF radio calibration data |
| `ota_0` / slot A | `0x010000` | `0x1d0000` | Application image |
| `ota_1` / slot B | `0x1e0000` | `0x1d0000` | Application image |
| `fwmeta0` | `0x3b0000` | `0x001000` | Primary fwctl state |
| `fwmeta1` | `0x3b1000` | `0x001000` | Alternate fwctl state |
| Reserved | `0x3b2000` | `0x04e000` | Application-specific data |

The custom metadata partitions use application-defined partition type `0x40`.
They must not be moved independently of `SLOT_LAYOUT`. Both application offsets
are 64 KiB aligned and all writable regions are 4 KiB aligned.

## ESP-IDF bindings

At startup, resolve `ota_0`, `ota_1`, `fwmeta0`, and `fwmeta1` from the running
partition table and reject the configuration unless every address and size
matches `Esp32Partition::region()`. This catches a stale CSV before an update can
touch flash.

Implement `Esp32PartitionDriver` with the partition API:

- `erase` maps to `esp_partition_erase_range`;
- `write` maps to `esp_partition_write`;
- `read` maps to `esp_partition_read`.

Offsets passed to the driver are partition-relative. `Esp32Flash` rejects
reserved space, cross-partition I/O, unaligned erase requests, and address
overflow before invoking ESP-IDF. The generic updater separately prevents the
running confirmed slot from becoming an update target and persists transfer
offsets in the alternating fwctl metadata partitions, so reconnecting can
continue from the last checkpoint without erasing accepted bytes.

Implement `Esp32OtaControl` as follows:

| Rust method | ESP-IDF operation |
|---|---|
| `running_partition` | `esp_ota_get_running_partition`, mapped by partition address |
| `verify_partition` | `esp_image_verify(ESP_IMAGE_VERIFY, ...)` over the selected OTA partition |
| `set_boot_partition` | `esp_ota_set_boot_partition` |
| `mark_running_valid` | `esp_ota_mark_app_valid_cancel_rollback` |
| `restart` | `esp_restart` |

The image verifier binding needs `bootloader_support`; OTA selection and
confirmation need `app_update`. Keep the raw FFI and pointer lifetime checks in
the board crate. Do not put unsafe code in `fwctl-device`.

## Application lifecycle

Construct `Esp32ReferenceApp` with an `Esp32Flash`, `DeviceSerialLink`, protocol
handler, and OTA control implementation. The intended lifecycle is:

1. Load or provision `DeviceUpdater` with `SLOT_LAYOUT`.
2. Call `prepare_boot` during startup. It reconciles the persisted fwctl decision
   with the running ESP-IDF partition and restarts if a different slot must run.
3. Set `services_ready` after ESP-IDF services and persistent state initialize.
4. Repeatedly call `service_serial`; the app latches protocol readiness after a
   valid request is served.
5. When the last firmware chunk arrives, call `finalize_candidate`. It verifies
   the fwctl SHA-256, validates the ESP application image and secure-boot
   signature when enabled, persists the candidate, and selects its OTA partition.
6. Restart only after the response has been fully transmitted.
7. On candidate startup, complete the application self-test, set
   `application_ready`, and call `confirm_if_healthy`.

Confirmation checks all three health signals and verifies that ESP-IDF reports
the expected candidate as the running partition. It marks the ESP-IDF image
valid before advancing fwctl's confirmed slot and rollback counter. A manual
rejection uses `rollback_and_restart`, which persists the confirmed slot,
selects its OTA partition, and restarts.

The serial request handler should report candidate finalization to its owning
application instead of calling `DeviceUpdater::set_candidate` directly. This
keeps ESP image validation and boot selection in the required order.

## Build and test without hardware

Copy `partitions.csv` and `sdkconfig.defaults` into the ESP-IDF application root,
or point the application build at these files. With the ESP-IDF toolchain
installed, build the partition table and firmware normally:

```sh
idf.py partition-table
idf.py build
```

The hardware-independent adapter and lifecycle tests run on the development
host:

```sh
cargo test -p fwctl-device boards::esp32
cargo check -p fwctl-device --no-default-features
```

CI also parses this exact CSV and fails if any OTA or fwctl metadata region
drifts from the Rust layout, exceeds flash capacity, or overlaps another region.

These tests exercise partition routing, reserved-range rejection, candidate
validation, boot selection, health gating, confirmation, and exhausted-attempt
rollback. They do not replace a physical power-loss and bootloader test.

## Physical validation when a board is available

Flash the bootloader, partition table, and an initial slot-A application with
`idf.py flash`. Then run the normal fwctl update workflow over the serial device.
Capture serial logs and machine-readable output for these cases:

| Case | Required result |
|---|---|
| Normal update | Slot B validates, boots, and becomes confirmed |
| Interrupted transfer | Reconnect resumes at the persisted offset; slot A is untouched |
| Invalid ESP image | `finalize_candidate` fails before OTA selection changes |
| Failed health check | Candidate is never confirmed and boot returns to slot A |
| Metadata power loss | The previous CRC-valid fwctl metadata generation loads |
| Manual rollback | ESP-IDF selects the confirmed partition and restarts |

When secure boot or flash encryption is enabled, repeat normal update and
invalid-image cases with production-equivalent keys and eFuse policy.

Upstream behavior is defined by Espressif's [partition-table guide][partitions]
and [OTA API reference][ota].

[partitions]: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/partition-tables.html
[ota]: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/ota.html
