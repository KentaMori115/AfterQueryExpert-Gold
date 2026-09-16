use std::fmt::Write;

use fwctl_core::history::{HistoryRecord, HistoryStore};
use fwctl_core::{Config, Result};
use serde::Serialize;

use crate::cli::HistoryArgs;
use crate::output::StdOutput;

#[derive(Serialize)]
struct HistoryOutput {
    records: Vec<HistoryRecord>,
}

pub fn run(args: &HistoryArgs, config: &Config, output: &mut StdOutput) -> Result<()> {
    let records =
        HistoryStore::new(&config.history_file).read(args.device.as_deref(), args.limit)?;
    let human = render(&records);
    output.success(&HistoryOutput { records }, format_args!("{human}"))
}

fn render(records: &[HistoryRecord]) -> String {
    if records.is_empty() {
        return "No firmware update history".into();
    }
    let mut lines = String::from(
        "TIMESTAMP                       DEVICE              UPDATE                 RESULT\n",
    );
    for record in records.iter().rev() {
        let _ = writeln!(
            lines,
            "{:<31} {:<19} {:<22} {:?}",
            record.timestamp,
            record.device_id,
            format!("{} -> {}", record.old_version, record.new_version),
            record.result
        );
    }
    lines.pop();
    lines
}

#[cfg(test)]
mod tests {
    use fwctl_core::history::HistoryResult;

    use super::*;

    #[test]
    fn renders_newest_record_first() {
        let record = |version: &str| HistoryRecord {
            timestamp: format!("2026-08-31T10:00:0{version}Z"),
            device_id: "board".into(),
            product: "meter".into(),
            old_version: "1.0.0".into(),
            new_version: version.into(),
            package_hash: "00".repeat(32),
            signing_key: "release".into(),
            result: HistoryResult::Completed,
            duration_ms: 10,
            rollback_result: None,
            error_category: None,
        };
        let text = render(&[record("1"), record("2")]);
        assert!(text.find("1.0.0 -> 2").unwrap() < text.find("1.0.0 -> 1").unwrap());
    }
}
