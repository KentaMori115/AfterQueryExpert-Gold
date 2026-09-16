use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::{FwctlError, Result};

const DEFAULT_CHUNK_SIZE: usize = 1024;
const MAX_CHUNK_SIZE: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    #[serde(with = "humantime_serde")]
    pub default_timeout: Duration,
    #[serde(with = "humantime_serde")]
    pub reconnect_timeout: Duration,
    pub chunk_size: usize,
    pub trust_store: PathBuf,
    pub history_file: PathBuf,
    pub staging_file: PathBuf,
}

impl Default for Config {
    fn default() -> Self {
        let paths = ConfigPaths::discover().unwrap_or_else(|_| ConfigPaths::relative_fallback());
        Self {
            default_timeout: Duration::from_secs(5),
            reconnect_timeout: Duration::from_secs(20),
            chunk_size: DEFAULT_CHUNK_SIZE,
            trust_store: paths.trust_store,
            history_file: paths.history_file,
            staging_file: paths.staging_file,
        }
    }
}

impl Config {
    pub fn load(config_path: Option<&Path>) -> Result<Self> {
        let path = config_path.map_or_else(
            || ConfigPaths::discover().map(|paths| paths.config_file),
            |path| Ok(path.to_path_buf()),
        )?;

        if !path.exists() {
            let config = Self::default();
            config.validate()?;
            return Ok(config);
        }

        let source = fs::read_to_string(&path).map_err(|err| FwctlError::io(&path, err))?;
        let mut config: Self = toml::from_str(&source)
            .map_err(|err| FwctlError::Configuration(format!("{}: {err}", path.display())))?;
        let base_dir = path.parent().unwrap_or_else(|| Path::new("."));
        config.trust_store = resolve_relative(base_dir, &config.trust_store);
        config.history_file = resolve_relative(base_dir, &config.history_file);
        config.staging_file = resolve_relative(base_dir, &config.staging_file);
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.default_timeout.is_zero() {
            return Err(FwctlError::Configuration(
                "default_timeout must be greater than zero".into(),
            ));
        }
        if self.reconnect_timeout < self.default_timeout {
            return Err(FwctlError::Configuration(
                "reconnect_timeout must not be shorter than default_timeout".into(),
            ));
        }
        if !(256..=MAX_CHUNK_SIZE).contains(&self.chunk_size) {
            return Err(FwctlError::Configuration(format!(
                "chunk_size must be between 256 and {MAX_CHUNK_SIZE} bytes"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigPaths {
    pub config_file: PathBuf,
    pub trust_store: PathBuf,
    pub history_file: PathBuf,
    pub staging_file: PathBuf,
}

impl ConfigPaths {
    pub fn discover() -> Result<Self> {
        let dirs = ProjectDirs::from("dev", "fwctl", "fwctl").ok_or_else(|| {
            FwctlError::Configuration("could not determine user configuration directory".into())
        })?;
        let state_dir = dirs.state_dir().unwrap_or_else(|| dirs.data_local_dir());
        Ok(Self {
            config_file: dirs.config_dir().join("config.toml"),
            trust_store: dirs.config_dir().join("keys"),
            history_file: state_dir.join("history.jsonl"),
            staging_file: state_dir.join("staged.jsonl"),
        })
    }

    fn relative_fallback() -> Self {
        Self {
            config_file: PathBuf::from("config.toml"),
            trust_store: PathBuf::from("keys"),
            history_file: PathBuf::from("history.jsonl"),
            staging_file: PathBuf::from("staged.jsonl"),
        }
    }
}

fn resolve_relative(base_dir: &Path, configured: &Path) -> PathBuf {
    if configured.is_absolute() {
        configured.to_path_buf()
    } else {
        base_dir.join(configured)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn defaults_match_transport_policy() {
        let config = Config::default();
        assert_eq!(config.default_timeout, Duration::from_secs(5));
        assert_eq!(config.reconnect_timeout, Duration::from_secs(20));
        assert_eq!(config.chunk_size, 1024);
    }

    #[test]
    fn relative_paths_follow_config_location() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fwctl.toml");
        fs::write(
            &path,
            r#"
default_timeout = "3s"
reconnect_timeout = "15s"
chunk_size = 2048
trust_store = "release-keys"
history_file = "state/history.jsonl"
staging_file = "state/staged.jsonl"
"#,
        )
        .unwrap();

        let config = Config::load(Some(&path)).unwrap();
        assert_eq!(config.default_timeout, Duration::from_secs(3));
        assert_eq!(config.trust_store, dir.path().join("release-keys"));
        assert_eq!(config.history_file, dir.path().join("state/history.jsonl"));
        assert_eq!(config.staging_file, dir.path().join("state/staged.jsonl"));
    }

    #[test]
    fn staged_updates_default_beside_history() {
        let config = Config::default();
        assert_eq!(
            config.staging_file.parent(),
            config.history_file.parent(),
            "staged updates belong in the same state directory as history"
        );
        assert_eq!(
            config.staging_file.file_name().and_then(|name| name.to_str()),
            Some("staged.jsonl")
        );
    }

    #[test]
    fn rejects_unsafe_chunk_extremes() {
        let config = Config {
            chunk_size: 32,
            ..Config::default()
        };
        assert!(matches!(
            config.validate(),
            Err(FwctlError::Configuration(_))
        ));
    }

    #[test]
    fn rejects_unknown_configuration_fields() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "serial_baud = 115200\n").unwrap();
        assert!(matches!(
            Config::load(Some(&path)),
            Err(FwctlError::Configuration(_))
        ));
    }

    #[test]
    fn rejects_zero_and_inverted_timeouts() {
        let zero = Config {
            default_timeout: Duration::ZERO,
            ..Config::default()
        };
        assert!(zero.validate().unwrap_err().to_string().contains("zero"));

        let inverted = Config {
            default_timeout: Duration::from_secs(4),
            reconnect_timeout: Duration::from_secs(3),
            ..Config::default()
        };
        assert!(
            inverted
                .validate()
                .unwrap_err()
                .to_string()
                .contains("shorter")
        );
    }

    #[test]
    fn accepts_chunk_size_boundary_values() {
        for chunk_size in [256, MAX_CHUNK_SIZE] {
            let config = Config {
                chunk_size,
                ..Config::default()
            };
            assert!(config.validate().is_ok());
        }
    }
}
