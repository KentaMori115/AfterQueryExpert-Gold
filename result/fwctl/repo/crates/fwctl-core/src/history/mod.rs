use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{ErrorCategory, FwctlError, Result};

const MAX_HISTORY_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryResult {
    Completed,
    Failed,
    RolledBack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub timestamp: String,
    pub device_id: String,
    pub product: String,
    pub old_version: String,
    pub new_version: String,
    pub package_hash: String,
    pub signing_key: String,
    pub result: HistoryResult,
    pub duration_ms: u128,
    pub rollback_result: Option<String>,
    pub error_category: Option<ErrorCategory>,
}

impl HistoryRecord {
    #[must_use]
    pub fn now(
        device_id: String,
        product: String,
        old_version: String,
        new_version: String,
        package_hash: String,
        signing_key: String,
    ) -> Self {
        Self {
            timestamp: jiff::Timestamp::now().to_string(),
            device_id,
            product,
            old_version,
            new_version,
            package_hash,
            signing_key,
            result: HistoryResult::Failed,
            duration_ms: 0,
            rollback_result: None,
            error_category: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn append(&self, record: &HistoryRecord) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| FwctlError::io(parent, err))?;
        }
        let mut line =
            serde_json::to_vec(record).map_err(|err| FwctlError::Configuration(err.to_string()))?;
        line.push(b'\n');
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|err| FwctlError::io(&self.path, err))?;
        file.write_all(&line)
            .map_err(|err| FwctlError::io(&self.path, err))?;
        file.sync_data()
            .map_err(|err| FwctlError::io(&self.path, err))
    }

    pub fn read(&self, device_id: Option<&str>, limit: usize) -> Result<Vec<HistoryRecord>> {
        if !self.path.exists() || limit == 0 {
            return Ok(Vec::new());
        }
        let file = File::open(&self.path).map_err(|err| FwctlError::io(&self.path, err))?;
        let length = file
            .metadata()
            .map_err(|err| FwctlError::io(&self.path, err))?
            .len();
        if length > MAX_HISTORY_BYTES {
            return Err(FwctlError::Configuration(format!(
                "history file exceeds {MAX_HISTORY_BYTES} bytes"
            )));
        }
        let mut records = Vec::new();
        for (line_index, line) in BufReader::new(file).lines().enumerate() {
            let line = line.map_err(|err| FwctlError::io(&self.path, err))?;
            if line.trim().is_empty() {
                continue;
            }
            let record: HistoryRecord = serde_json::from_str(&line).map_err(|err| {
                FwctlError::Configuration(format!(
                    "invalid history record at line {}: {err}",
                    line_index + 1
                ))
            })?;
            if device_id.is_none_or(|selected| record.device_id == selected) {
                records.push(record);
            }
        }
        let keep_from = records.len().saturating_sub(limit);
        Ok(records.split_off(keep_from))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(device_id: &str, version: &str) -> HistoryRecord {
        HistoryRecord {
            timestamp: "2026-08-31T10:00:00Z".into(),
            device_id: device_id.into(),
            product: "sensor-node".into(),
            old_version: "1.0.0".into(),
            new_version: version.into(),
            package_hash: "ab".repeat(32),
            signing_key: "release".into(),
            result: HistoryResult::Completed,
            duration_ms: 2400,
            rollback_result: None,
            error_category: None,
        }
    }

    #[test]
    fn appends_and_filters_json_lines() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path().join("state/history.jsonl"));
        store.append(&record("board-a", "1.1.0")).unwrap();
        store.append(&record("board-b", "1.2.0")).unwrap();
        store.append(&record("board-a", "1.3.0")).unwrap();
        let records = store.read(Some("board-a"), 20).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[1].new_version, "1.3.0");
    }

    #[test]
    fn returns_only_newest_limit() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path().join("history.jsonl"));
        store.append(&record("board", "1.1.0")).unwrap();
        store.append(&record("board", "1.2.0")).unwrap();
        assert_eq!(store.read(None, 1).unwrap()[0].new_version, "1.2.0");
    }

    #[test]
    fn rejects_corrupt_record_with_line_number() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        fs::write(&path, "{broken}\n").unwrap();
        let err = HistoryStore::new(path).read(None, 10).unwrap_err();
        assert!(err.to_string().contains("line 1"));
    }
}
