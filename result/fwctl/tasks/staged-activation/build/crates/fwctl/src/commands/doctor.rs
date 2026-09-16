use std::fmt::Write;
use std::path::Path;
use std::time::Duration;

use fwctl_core::crypto::TrustStore;
use fwctl_core::device::discover_serial_devices;
use fwctl_core::{Config, ConfigPaths, Result};
use serde::Serialize;

use crate::output::StdOutput;

#[derive(Debug, Clone, Serialize)]
struct DoctorCheck {
    name: &'static str,
    ok: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
struct DoctorOutput {
    healthy: bool,
    checks: Vec<DoctorCheck>,
}

pub fn run(config: &Config, output: &mut StdOutput) -> Result<()> {
    let mut checks = path_checks(config);
    match TrustStore::new(&config.trust_store).list() {
        Ok(keys) => checks.push(DoctorCheck {
            name: "trusted_keys",
            ok: true,
            detail: format!("{} configured key(s)", keys.len()),
        }),
        Err(err) => checks.push(DoctorCheck {
            name: "trusted_keys",
            ok: false,
            detail: err.to_string(),
        }),
    }
    match discover_serial_devices(Duration::from_millis(200)) {
        Ok(devices) => checks.push(DoctorCheck {
            name: "serial_devices",
            ok: true,
            detail: format!("{} compatible device(s) detected", devices.len()),
        }),
        Err(err) => checks.push(DoctorCheck {
            name: "serial_devices",
            ok: false,
            detail: err.to_string(),
        }),
    }
    let healthy = checks.iter().all(|check| check.ok);
    let human = render(&checks, healthy);
    output.success(&DoctorOutput { healthy, checks }, format_args!("{human}"))
}

fn path_checks(config: &Config) -> Vec<DoctorCheck> {
    let paths = ConfigPaths::discover();
    let config_detail = paths.as_ref().map_or_else(ToString::to_string, |paths| {
        paths.config_file.display().to_string()
    });
    vec![
        DoctorCheck {
            name: "configuration_path",
            ok: paths.is_ok(),
            detail: config_detail,
        },
        writable_parent("trust_store", &config.trust_store),
        writable_parent("history_file", &config.history_file),
    ]
}

fn writable_parent(name: &'static str, path: &Path) -> DoctorCheck {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let existing = parent.ancestors().find(|candidate| candidate.exists());
    let ok = existing.is_some_and(|candidate| {
        candidate
            .metadata()
            .is_ok_and(|metadata| !metadata.permissions().readonly())
    });
    DoctorCheck {
        name,
        ok,
        detail: path.display().to_string(),
    }
}

fn render(checks: &[DoctorCheck], healthy: bool) -> String {
    let mut report = if healthy {
        String::from("fwctl environment is ready\n")
    } else {
        String::from("fwctl environment has problems\n")
    };
    for check in checks {
        let marker = if check.ok { "ok" } else { "fail" };
        let _ = writeln!(
            report,
            "  [{marker:<4}] {:<20} {}",
            check.name, check.detail
        );
    }
    report.pop();
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_resolvable_output_parents() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config {
            trust_store: dir.path().join("missing/keys"),
            history_file: dir.path().join("state/history.jsonl"),
            ..Config::default()
        };
        let checks = path_checks(&config);
        assert!(checks.iter().all(|check| check.ok));
    }
}
