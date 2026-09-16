use fwctl_core::crypto::{TrustStore, TrustedKeyRecord};
use fwctl_core::{Config, FwctlError, Result};
use serde::Serialize;

use crate::cli::KeyAction;
use crate::output::StdOutput;

#[derive(Serialize)]
struct KeyList {
    keys: Vec<TrustedKeyRecord>,
}

#[derive(Serialize)]
struct KeyMutation<'a> {
    action: &'a str,
    key_id: &'a str,
    fingerprint: Option<&'a str>,
}

pub fn run(action: &KeyAction, config: &Config, output: &mut StdOutput) -> Result<()> {
    let store = TrustStore::new(&config.trust_store);
    match action {
        KeyAction::List => list(&store, output),
        KeyAction::Add { key, id } => {
            let key_id = id.as_deref().map_or_else(
                || {
                    key.file_stem()
                        .and_then(|value| value.to_str())
                        .map(str::to_owned)
                        .ok_or_else(|| {
                            FwctlError::Configuration(
                                "could not derive key ID from public-key filename".into(),
                            )
                        })
                },
                |id| Ok(id.to_owned()),
            )?;
            let record = store.add(key, &key_id)?;
            let result = KeyMutation {
                action: "added",
                key_id: &record.key_id,
                fingerprint: Some(&record.fingerprint),
            };
            output.success(
                &result,
                format_args!(
                    "Added trusted key {}\n  Fingerprint: {}",
                    record.key_id, record.fingerprint
                ),
            )
        }
        KeyAction::Remove { id } => {
            store.remove(id)?;
            output.success(
                &KeyMutation {
                    action: "removed",
                    key_id: id,
                    fingerprint: None,
                },
                format_args!("Removed trusted key {id}"),
            )
        }
    }
}

fn list(store: &TrustStore, output: &mut StdOutput) -> Result<()> {
    let keys = store.list()?;
    let human = if keys.is_empty() {
        "No trusted signing keys configured".to_owned()
    } else {
        keys.iter()
            .map(|key| format!("{}  {}", key.key_id, key.fingerprint))
            .collect::<Vec<_>>()
            .join("\n")
    };
    output.success(&KeyList { keys }, format_args!("{human}"))
}
