# Raspberry Pi Pico 2 reference target

The v0.1 reference target is Raspberry Pi Pico 2: RP2350 with 4 MiB external
QSPI flash and USB CDC serial. The reusable integration lives in
`fwctl_device::boards::pico2`; application firmware supplies the concrete flash,
partition-selection, USB serial, and health implementations.

## Flash map

All addresses are offsets from the start of external flash.

| Region | Start | Length | Purpose |
|---|---:|---:|---|
| Boot/reserved | `0x000000` | `0x020000` | RP2350 boot data and immutable update stub |
| Slot A | `0x020000` | `0x1d0000` | Confirmed or inactive application image |
| Slot B | `0x1f0000` | `0x1d0000` | Confirmed or inactive application image |
| Metadata A | `0x3c0000` | `0x001000` | Primary 4 KiB boot metadata sector |
| Metadata B | `0x3c1000` | `0x001000` | Alternate 4 KiB boot metadata sector |
| Reserved | `0x3c2000` | `0x03e000` | Future board data; never used by fwctl v0.1 |

Both application slots have identical capacity and are 4 KiB aligned. Firmware
images must be linked for the slot selected by the RP2350 partition table, or be
position-independent with a board-specific handoff. The application partition
table must exactly match `SLOT_LAYOUT`; a mismatch is a release-blocking fault.

## Adapter contract

Implement `Rp2350FlashDriver` using the board's RAM-resident QSPI flash routines:

- `erase_sector` erases one aligned 4096-byte sector;
- `program_page` accepts no write crossing a 256-byte page boundary;
- `read` returns memory-mapped flash bytes after any required cache maintenance.

`Pico2Flash` performs capacity, sector-alignment, overflow, and page-splitting
checks before invoking the driver. The low-level implementation must follow the
RP2350 rule that flash cannot be executed through XIP while an erase or program
operation is active. Keep that unsafe, target-specific code outside
`fwctl-device`; the shared update state machine itself forbids unsafe Rust.

Implement `Rp2350BootControl::select_boot_partition` by updating the redundant
RP2350 partition-table selection state. Call `DeviceUpdater::prepare_boot`, pass
its result to `apply_boot_decision`, flush persistent state, and then trigger the
watchdog reset. Never derive the boot slot from a host request directly.

## USB protocol task

Expose one USB CDC ACM interface and feed its byte stream through the v0.1 frame
decoder. `Rp2350UsbSerialDriver` binds the HAL endpoint, while `Pico2UsbLink`
performs bounded buffering, boot-noise resynchronization, version/length/CRC
validation, sequence correlation, and host-compatible response framing. Implement
`Pico2FrameHandler` to dispatch decoded payloads to the supplied `DeviceUpdater`;
serialize each response before accepting another state-mutating request. The
stable device ID returned by `HELLO` must come from provisioned board identity,
not the USB path, because Linux enumeration can change after reset.

The task must stay responsive while hashing and programming. It may process flash
operations synchronously, but USB reads need bounded buffering and the watchdog
must be serviced between sectors and hash blocks.

## Health and confirmation

Construct `Pico2Health` from three independent signals:

1. clocks, memory, and persistent application state initialized successfully;
2. USB update protocol is enumerated and answering local requests;
3. the application-specific control loop or sensor path passed its startup check.

Only call `confirm_candidate` when `ready_to_confirm()` is true. Do not confirm
from a timer alone. If startup resets or stalls, the boot-attempt counter remains
unconfirmed and the third boot decision restores the previous slot.

`Pico2ReferenceApp` is the minimal application coordinator: it owns the updater,
USB link, request handler, and health latch; selects the persisted boot decision;
and refuses confirmation until all health signals are asserted.

## Bring-up sequence

1. Build the board firmware for `thumbv8m.main-none-eabihf` with the partition
   definition generated from the map above.
2. Install the immutable updater/boot image through BOOTSEL or a debug probe.
3. Provision the device ID and at least one Ed25519 release public key.
4. Boot slot A and verify `fwctl devices`, `fwctl info`, and `fwctl status` report
   the expected identity, versions, slot, and rollback counter.
5. Package a slot-B image with a higher version and rollback counter, add the
   matching public key to the host trust store, and run `fwctl update`.
6. Confirm the device reconnects under the same stable ID and reports slot B as
   confirmed with the new version.

## Physical validation checklist

Run every case with serial logs and `fwctl --json` output captured as release
evidence. A v0.1 hardware sign-off requires all rows.

| Case | Intervention | Required result |
|---|---|---|
| Normal update | None | Slot B becomes confirmed; counter advances |
| Transfer resume | Unplug during a middle chunk, reconnect | Transfer resumes at stored offset without erasing slot A |
| Corrupt image | Alter a payload byte before device verification | Candidate is never set |
| Bad authorization | Sign with a host-only trusted key | Device rejects `BEGIN_UPDATE` before erase |
| Failed health | Hold application readiness false | Candidate remains unconfirmed and automatically rolls back |
| Power loss in metadata write | Remove power while alternate copy is written | Previous CRC-valid generation boots |
| Manual rollback | Install healthy candidate, request rollback before confirm | Slot A runs and candidate state clears |

After the run, inspect `fwctl history`, read both metadata sectors through the
debug probe, and retain the package SHA-256, host commit, board build commit,
serial log, and command output together. Simulator results are necessary but do
not substitute for this physical sign-off.
