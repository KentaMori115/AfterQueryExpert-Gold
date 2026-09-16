use std::fs::File;
use std::time::Duration;
use std::time::Instant;

use fwctl_core::crypto::TrustStore;
use fwctl_core::device::discover_serial_devices;
use fwctl_core::history::{HistoryRecord, HistoryResult, HistoryStore};
use fwctl_core::package::{digest_reader, read_package};
use fwctl_core::transport::SerialConnector;
use fwctl_core::update::{UpdateEngine, UpdatePolicy, UpdateState};
use fwctl_core::{Config, FwctlError, Result};

use crate::cli::UpdateArgs;
use crate::commands::device::{probe_timeout, select_device};
use crate::output::StdOutput;

pub fn run(
    args: &UpdateArgs,
    target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
    output: &mut StdOutput,
) -> Result<()> {
    let package = read_package(&args.package)?;
    let (package_digest, _) = digest_reader(
        File::open(&args.package).map_err(|err| FwctlError::io(&args.package, err))?,
    )?;
    let trusted_key = TrustStore::new(&config.trust_store).load(&package.manifest.signing_key)?;
    let devices = discover_serial_devices(probe_timeout(timeout, config))?;
    let selected = select_device(&devices, target)?;
    let device_id = selected.info.device_id.clone();
    let chunk_size = args.chunk_size.unwrap_or(config.chunk_size);
    if !(256..=16 * 1024).contains(&chunk_size) {
        return Err(FwctlError::Configuration(
            "update chunk size must be between 256 and 16384 bytes".into(),
        ));
    }
    let response_timeout = timeout.unwrap_or(config.default_timeout);
    let mut engine = UpdateEngine::new(
        SerialConnector::default(),
        response_timeout,
        config.reconnect_timeout,
        chunk_size,
    );
    let mut last_state = UpdateState::Idle;
    let mut last_percent = 0_u32;
    let mut history = HistoryRecord::now(
        device_id.clone(),
        selected.info.product.clone(),
        selected.info.firmware_version.clone(),
        package.manifest.firmware_version.clone(),
        package_digest.to_hex(),
        package.manifest.signing_key.clone(),
    );
    let started = Instant::now();
    let update_result = engine.run(
        &device_id,
        &package,
        &trusted_key,
        UpdatePolicy {
            allow_downgrade: args.allow_downgrade,
        },
        |event| {
            let percent = event
                .bytes_transferred
                .saturating_mul(100)
                .checked_div(event.image_size)
                .unwrap_or(0);
            if event.state != last_state || percent >= last_percent.saturating_add(5) {
                let _ = output.progress(format_args!("{:?}  {percent}%", event.state));
                last_state = event.state;
                last_percent = percent;
            }
        },
    );
    history.duration_ms = started.elapsed().as_millis();
    let report = match update_result {
        Ok(report) => {
            history.result = HistoryResult::Completed;
            history.duration_ms = report.duration_ms;
            report
        }
        Err(err) => {
            history.error_category = Some(err.category());
            if matches!(err, FwctlError::AutomaticRollback) {
                history.result = HistoryResult::RolledBack;
                history.rollback_result = Some("automatic rollback completed".into());
            }
            append_history(config, &history, output);
            return Err(err);
        }
    };
    append_history(config, &history, output);
    output.success(
        &report,
        format_args!(
            "Updated {} from {} to {}\n  Active slot: {}\n  Image: {} bytes\n  Resumed connections: {}\n  Duration: {} ms",
            report.device_id,
            report.old_version,
            report.new_version,
            report.target_slot,
            report.image_size,
            report.resumed_connections,
            report.duration_ms
        ),
    )
}

fn append_history(config: &Config, record: &HistoryRecord, output: &mut StdOutput) {
    if let Err(err) = HistoryStore::new(&config.history_file).append(record) {
        let _ = output.warning(format_args!("could not record update history: {err}"));
    }
}
