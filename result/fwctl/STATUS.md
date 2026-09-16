# fwctl — repo record

14th codebase on the dragan seat, first **Rust** repo here.
Snapshot `snapshot.borrower-v2-g1788209777472029.zip` (68 files, 2026-09-03),
unpacked at `result/fwctl/repo`. No `.git`, read only.

## What it is

`fwctl` is a firmware-delivery system: signed `.fwpkg` archives, USB-serial
device discovery, compatibility and rollback policy, resumable chunked transfer,
health-gated A/B slot activation. Cargo workspace, edition 2024, rust-version
1.96, `unsafe_code = "forbid"` workspace-wide.

| crate | what it holds |
| --- | --- |
| `fwctl-core` | host side: config, crypto/trust store, package read/write, wire protocol, transport, update engine + policy, history |
| `fwctl-device` | portable `no_std` device side: flash trait, slot layout, CRC metadata sectors, updater state machine, serial framing, pico2 + esp32 board adapters |
| `fwctl-sim` | in-process device simulator driving the real `DeviceUpdater` over `MemoryTransport`, with injectable faults |
| `fwctl` | clap CLI |

17 external crates (clap, ed25519-dalek, zip, serialport, jiff, sha2, semver,
serde, toml, uuid, …). `Cargo.lock` is checked in.

## Base suite, local, green

`cargo test --workspace --all-targets --locked` → 162 passing, 0 failing.

| target | cases |
| --- | ---: |
| `fwctl` unit (`src/main.rs`) | 10 |
| `fwctl/tests/cli_process.rs` | 5 |
| `fwctl-core` unit | 79 |
| `fwctl-device` unit | 51 |
| `fwctl-device/tests/esp32_partition_contract.rs` | 2 |
| `fwctl-sim` unit | 6 |
| `fwctl-sim/tests/update_engine.rs` | 9 |

**p2p problem, decided.** A Rust verifier may only grade `tests/*.rs`: unit
tests live in `src/**`, which a solution edits, so they can neither be reset
from base nor pinned by digest, and a blanked body passes. Inherited
`tests/*.rs` here holds only **16** cases and the seat floor is 50. Fix: the
held-out patch carries a second graded file that uses base API only, so it
compiles and passes at the base commit — those cases are p2p by construction.
Declared p2p = 16 inherited + ~40 held out.

## Environment: use v1. v2 is broken.

Measured 2026-09-04, repo id `KH2YDwwGzHQfrFdZLzFu`. Both versions sit on base
`b016ef6d36ee` and both read `published`, but they are not the same image and
only one of them can compile the workspace. `task.toml` carries
`allow_internet = false` on the agent and the verifier, so a cargo cache baked
into the image is the whole ballgame.

| | v1 (2026-09-02 07:30) | v2 (2026-09-02 14:34) |
| --- | --- | --- |
| crates.io sources | `cargo vendor --locked --versioned-dirs /opt/cargo-vendor`, `[source.crates-io] replace-with`, `CARGO_NET_OFFLINE=true` | **none** |
| apt | base image only | ca-certificates, git, libudev-dev, pkg-config, python3 |
| rustup | base image only | `+ clippy rustfmt` |
| `$CARGO_HOME/registry` | vendored at `/opt/cargo-vendor` | **does not exist** |

Rebuilt each image locally from its own env-log Step lines and ran the base
suite under `docker run --network none`.

**v1: 162 of 162, exit 0.** No `--offline` flag needed; the vendored source
replacement and `CARGO_NET_OFFLINE=true` carry it. `serialport` builds without
`libudev-dev` or `pkg-config` because the workspace pins it
`default-features = false`. v1 has no `python3`, which does not matter:
`tests/Dockerfile` installs one when the base image lacks it.

**v2: nothing compiles.**

```
error: no matching package named `clap` found
location searched: crates.io index
required by package `fwctl v0.2.0 (/app/crates/fwctl)`
```

Without `--offline` it hangs retrying the network until killed. v2 apparently
traded the vendor layer for the apt and rustup layers.

**So a draft must be created on environment v1.** `create-task` defaults to the
newest published version, which is v2, and that is what draft
`rTs8X9NfQlGUmKcyk0Bo` got: its frozen `task.toml` says
`docker_image = ...gold-repo-fwctl-kh2ydw:v2`. That draft is unusable and cannot
be repaired, since `task.toml` is not ours to edit. The API takes an explicit
version (`gold.tasks.create` with `environmentVersion`, `gold_bot.py create-task
... --env 1`), so the replacement draft has to name v1.

`add-env` is not a route either way: it answers `403 Not your repository
(FORBIDDEN on gold.repos.environments.submitDockerfile)`, as on every assigned
repo. A candidate fix for v2 is kept at
`tasks/staged-activation/environment.v2.Dockerfile` anyway, in case the repo
owner ever wants it.

## Slate

| task | category | files it will touch | state |
| --- | --- | --- | --- |
| `staged-activation` | feature_request | `fwctl-core/src/{config,error}.rs`, `update/{engine,journal,mod}.rs`, `fwctl/src/main.rs` | verified and PUSHED 2026-09-04 to draft `h7uYvV4lITNt60iJDIWb` (env v1), awaiting submit |

Draft `rTs8X9NfQlGUmKcyk0Bo` was created on v2 and is dead; delete it once the
replacement has been pushed.

## staged-activation

`fwctl update` runs transfer, verify, set candidate, reboot, health check and
confirm in one call. Staged activation splits that: `UpdateEngine::stage` stops
after device-side digest verification and writes a `StagedUpdate` into a
`StagingJournal`, and `UpdateEngine::activate` finishes from that record alone,
refusing with `StagedUpdateLost` where the device has stopped matching it on
product, running version, rollback counter, held transfer or accepted bytes.

| | |
| --- | ---: |
| solution | 480 added lines over 6 files (churn 485) |
| held-out | 1146 added lines over 2 files |
| f2p | 21 (`crates/fwctl-sim/tests/deferred_boot.rs`) |
| p2p | 63: 52 held out (`host_update_contract.rs`) + 9 `update_engine` + 2 `esp32_partition_contract` |
| instruction | 283 words, 1.70 solution lines per word |

### Battery, run against the v1 image with `--network none`

| row | f2p | p2p | reward |
| --- | ---: | ---: | ---: |
| oracle | 21 | 63 | 1 |
| base, no patch | 0 | 63 | 0 |
| empty patch | 0 | 63 | 0 |
| `stage_writes_nothing` | 12 | 63 | 0 |
| `stage_goes_on_to_boot` | 13 | 63 | 0 |
| `stage_settles_on_the_wrong_state` | 19 | 63 | 0 |
| `activate_keeps_the_record` | 15 | 63 | 0 |
| `activate_ignores_the_counter` | 20 | 63 | 0 |
| `activate_ignores_the_running_version` | 20 | 63 | 0 |
| `activate_ignores_the_transfer_id` | 20 | 63 | 0 |
| `activate_ignores_the_accepted_bytes` | 20 | 63 | 0 |
| `activate_skips_the_digest` | 19 | 63 | 0 |
| `journal_keeps_every_record` | 15 | 63 | 0 |
| attack `build_script` | 0 | 0 | 0 |
| attack `cargo_runner` | 0 | 0 | 0 |
| attack `rewrites_an_inherited_suite` | 0 | 0 | 0 |
| attack `harness_false_manifest` | 0 | 0 | 0 |

Every mutation costs at least one graded case and none of them costs a p2p id,
which is what says the f2p cases assert their own rule and nothing else. Each
attack row was checked against the log line that caught it, not just its
numbers: `build.rs` and `.cargo` by the refused-path sweep, the rewritten
inherited suite and the `harness = false` manifest by their pinned digests.

**The residual is the libtest impersonator**, unchanged from baseforge: a test
binary runs submitted code in its own process, so ~25 lines of safe Rust reading
`/proc/self/exe --list` can print a transcript nobody in that process can
distinguish. Running every binary as uid 65534 closes the `/proc/self/fd` route,
and the planted cases, the listing check, the libtest logfile and the trailer
counts all have to agree, but no in-process harness closes the class. Not
described in the shipped `test.sh`, which states only what a run must satisfy.

**A first battery run reported f2p 0 / p2p 55 on every mutation row and it was
the box, not the task**: `/` had reached 100% and four parallel containers could
no longer write `/tmp`, so exactly the cases that touch the filesystem failed.
Check `df` before believing an all-zero row.

`crates/fwctl/tests/cli_process.rs` is deliberately NOT graded. Its cases run
the built binary through `CARGO_BIN_EXE_fwctl`, which points inside
`CARGO_TARGET_DIR`, and every graded binary runs as uid 65534; the extra
traversal that needs buys 5 p2p ids the task does not want.

## Round 3 — submitted 2026-09-04

Quality review (round 2) rejected on four criteria. Fixes applied:

- `list` returns records in an order the instruction never fixed → the assertion sorts before comparing.
- The promised "candidate already set" refusal was unreachable: `set_candidate` clears `next.transfer`,
  so that state is indistinguishable from a lost transfer. Clause dropped from instruction and engine.
- Short-bytes refusal was tested in the wrong direction and demanded exact equality →
  engine now refuses on `accepted_offset < image_size`; the case moves the offset with
  `saturating_add(512)` and is named `a_record_the_device_is_short_of_is_refused`.
- `staging_another_image_starts_a_new_transfer` no longer asserts `Erasing` (inherited behaviour,
  not something the instruction promises).

Battery: 23 rows, all as declared. Oracle 27/65 reward 1; base and empty 0/65; 13 mutants below 27;
4 attacks 0/0; 3 benign rows full reward.

Floors: solution +503/6 files, tests +1309/4 files, instruction 286 words, f2p 27, p2p 65, 1.76 lines/word.
Push carried one warning: solution-below-recommended (503 < 525).

### Round 3 verdict — PASSED all 8 stages, 2026-09-04 15:10

  ciChecks           passed        (2 warnings, both advisory)
  aiCheck            passed
  similarity         passed
  oracleNop          passed        oracle 1/1/1, nop 0/0/0
  qualityCheck       passed / pass
  easinessProbe      passed / pass 1 of 5 solved
  difficultyProbe    passed        skipped, nAttempts 0
  failureValidation  passed / pass

Status is now Needs Review (human review pending). Do not push to this draft again.
