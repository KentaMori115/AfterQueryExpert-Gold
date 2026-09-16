use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::device::{Slot, UpdateId};
use crate::package::ImageDigest;
use crate::update::UpdatePlan;
use crate::{FwctlError, Result};

const MAX_JOURNAL_BYTES: u64 = 1024 * 1024;

/// One firmware image that a device has accepted and verified but has not been
/// told to boot yet.
///
/// The record is what `activate` has instead of the package: the transfer is
/// already on the device, so everything the host still needs to decide whether
/// booting it is safe has to be written down at staging time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedUpdate {
    pub device_id: String,
    pub product: String,
    pub update_id: UpdateId,
    pub old_version: String,
    pub new_version: String,
    pub target_slot: Slot,
    pub image_size: u32,
    pub image_digest: ImageDigest,
    pub rollback_counter: u64,
    pub allow_downgrade: bool,
    pub signing_key: String,
    pub staged_at: String,
}

impl StagedUpdate {
    /// Take the record from a plan the policy has already accepted, stamped now.
    ///
    /// `allow_downgrade` travels with the record because activation weighs the
    /// staged image against what the device runs *then*, not what it ran when
    /// the transfer started, and a downgrade that an operator permitted at
    /// staging time is still permitted later.
    #[must_use]
    pub fn from_plan(plan: &UpdatePlan, update_id: UpdateId, allow_downgrade: bool) -> Self {
        Self {
            device_id: plan.device_id.clone(),
            product: plan.product.clone(),
            update_id,
            old_version: plan.old_version.clone(),
            new_version: plan.new_version.clone(),
            target_slot: plan.target_slot,
            image_size: plan.image_size,
            image_digest: plan.image_digest,
            rollback_counter: plan.rollback_counter,
            allow_downgrade,
            signing_key: plan.signing_key.clone(),
            staged_at: jiff::Timestamp::now().to_string(),
        }
    }
}

/// JSON-lines file holding at most one staged update per device.
#[derive(Debug, Clone)]
pub struct StagingJournal {
    path: PathBuf,
}

impl StagingJournal {
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every record currently held, oldest first.
    pub fn list(&self) -> Result<Vec<StagedUpdate>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let file = File::open(&self.path).map_err(|err| FwctlError::io(&self.path, err))?;
        let length = file
            .metadata()
            .map_err(|err| FwctlError::io(&self.path, err))?
            .len();
        if length > MAX_JOURNAL_BYTES {
            return Err(FwctlError::Configuration(format!(
                "staging journal exceeds {MAX_JOURNAL_BYTES} bytes"
            )));
        }
        let mut staged = Vec::new();
        for (line_index, line) in BufReader::new(file).lines().enumerate() {
            let line = line.map_err(|err| FwctlError::io(&self.path, err))?;
            if line.trim().is_empty() {
                continue;
            }
            let record: StagedUpdate = serde_json::from_str(&line).map_err(|err| {
                FwctlError::Configuration(format!(
                    "invalid staged update at line {}: {err}",
                    line_index + 1
                ))
            })?;
            staged.push(record);
        }
        Ok(staged)
    }

    /// The record held for one device, if there is one.
    pub fn get(&self, device_id: &str) -> Result<Option<StagedUpdate>> {
        Ok(self
            .list()?
            .into_iter()
            .find(|record| record.device_id == device_id))
    }

    /// Write `record`, replacing whatever this device had staged before.
    pub fn record(&self, record: &StagedUpdate) -> Result<()> {
        let mut kept = self.list()?;
        kept.retain(|held| held.device_id != record.device_id);
        kept.push(record.clone());
        self.rewrite(&kept)
    }

    /// Drop this device's record. Reports whether one was there.
    pub fn discard(&self, device_id: &str) -> Result<bool> {
        let kept = self.list()?;
        let remaining: Vec<StagedUpdate> = kept
            .iter()
            .filter(|held| held.device_id != device_id)
            .cloned()
            .collect();
        if remaining.len() == kept.len() {
            return Ok(false);
        }
        self.rewrite(&remaining)?;
        Ok(true)
    }

    fn rewrite(&self, records: &[StagedUpdate]) -> Result<()> {
        let directory = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(directory).map_err(|err| FwctlError::io(directory, err))?;
        let mut body = Vec::new();
        for record in records {
            serde_json::to_writer(&mut body, record)
                .map_err(|err| FwctlError::Configuration(err.to_string()))?;
            body.push(b'\n');
        }
        let mut staged =
            NamedTempFile::new_in(directory).map_err(|err| FwctlError::io(directory, err))?;
        staged
            .write_all(&body)
            .map_err(|err| FwctlError::io(staged.path(), err))?;
        staged
            .as_file()
            .sync_all()
            .map_err(|err| FwctlError::io(staged.path(), err))?;
        staged
            .persist(&self.path)
            .map_err(|err| FwctlError::io(&self.path, err.error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package::digest_bytes;

    fn record(device_id: &str, version: &str) -> StagedUpdate {
        StagedUpdate {
            device_id: device_id.into(),
            product: "sensor-node".into(),
            update_id: UpdateId::from_bytes([7; 16]),
            old_version: "1.0.0".into(),
            new_version: version.into(),
            target_slot: Slot::B,
            image_size: 4096,
            image_digest: digest_bytes(b"image"),
            rollback_counter: 4,
            allow_downgrade: false,
            signing_key: "release".into(),
            staged_at: "2021-03-15T09:00:00Z".into(),
        }
    }

    #[test]
    fn one_record_per_device_and_newest_wins() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("state/staged.jsonl"));
        journal.record(&record("board-a", "1.1.0")).unwrap();
        journal.record(&record("board-b", "1.2.0")).unwrap();
        journal.record(&record("board-a", "1.3.0")).unwrap();
        assert_eq!(journal.list().unwrap().len(), 2);
        assert_eq!(
            journal.get("board-a").unwrap().unwrap().new_version,
            "1.3.0"
        );
    }

    #[test]
    fn discard_reports_whether_anything_was_held() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("staged.jsonl"));
        journal.record(&record("board-a", "1.1.0")).unwrap();
        assert!(journal.discard("board-a").unwrap());
        assert!(!journal.discard("board-a").unwrap());
        assert!(journal.get("board-a").unwrap().is_none());
    }

    #[test]
    fn missing_journal_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("absent.jsonl"));
        assert!(journal.list().unwrap().is_empty());
        assert!(journal.get("board-a").unwrap().is_none());
    }

    #[test]
    fn corrupt_line_is_reported_with_its_number() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("staged.jsonl");
        fs::write(&path, "{broken}\n").unwrap();
        let err = StagingJournal::new(path).list().unwrap_err();
        assert!(err.to_string().contains("line 1"));
    }

    #[test]
    fn records_stay_in_the_order_they_were_written() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("staged.jsonl"));
        for device in ["board-a", "board-b", "board-c"] {
            journal.record(&record(device, "1.1.0")).unwrap();
        }
        let held = journal.list().unwrap();
        let devices: Vec<&str> = held.iter().map(|r| r.device_id.as_str()).collect();
        assert_eq!(devices, ["board-a", "board-b", "board-c"]);
    }

    #[test]
    fn restaging_moves_a_device_to_the_end() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("staged.jsonl"));
        journal.record(&record("board-a", "1.1.0")).unwrap();
        journal.record(&record("board-b", "1.2.0")).unwrap();
        journal.record(&record("board-a", "1.3.0")).unwrap();
        let held = journal.list().unwrap();
        let devices: Vec<&str> = held.iter().map(|r| r.device_id.as_str()).collect();
        assert_eq!(devices, ["board-b", "board-a"]);
    }

    #[test]
    fn discarding_the_last_record_leaves_an_empty_journal() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("staged.jsonl"));
        journal.record(&record("board-a", "1.1.0")).unwrap();
        assert!(journal.discard("board-a").unwrap());
        assert!(journal.list().unwrap().is_empty());
        assert_eq!(fs::read_to_string(journal.path()).unwrap(), "");
    }

    #[test]
    fn plan_becomes_a_record_with_a_timestamp() {
        let plan = UpdatePlan {
            device_id: "board-a".into(),
            product: "sensor-node".into(),
            old_version: "1.0.0".into(),
            new_version: "1.4.0".into(),
            target_slot: Slot::B,
            image_size: 2048,
            image_digest: digest_bytes(b"payload"),
            rollback_counter: 9,
            signing_key: "release".into(),
        };
        let staged = StagedUpdate::from_plan(&plan, UpdateId::from_bytes([3; 16]), true);
        assert_eq!(staged.new_version, "1.4.0");
        assert!(staged.allow_downgrade);
        assert!(staged.staged_at.ends_with('Z'));
    }

    #[test]
    fn record_round_trips_through_json() {
        let dir = tempfile::tempdir().unwrap();
        let journal = StagingJournal::new(dir.path().join("staged.jsonl"));
        let held = record("board-a", "2.0.0");
        journal.record(&held).unwrap();
        assert_eq!(journal.get("board-a").unwrap().unwrap(), held);
    }
}
