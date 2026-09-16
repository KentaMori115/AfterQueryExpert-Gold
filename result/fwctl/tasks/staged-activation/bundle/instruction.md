`fwctl update` runs everything in one go, transfer through confirm. Pushing an image over serial
takes minutes, and a safe reboot window often lands hours later. Split it in two.

`UpdateEngine::stage` takes what `run` takes, with a `&StagingJournal` before the observer, and
does everything `run` does up to device side digest verification. No candidate is selected and
no reboot happens, so the device stays on confirmed firmware. Engine state settles on a new
`UpdateState::Staged`. Whatever stops it short stages nothing. Staging an image a device already
has a record for continues that transfer, so nothing is erased or sent twice.

It returns and journals a `StagedUpdate` whose public fields are `device_id`, `product`,
`update_id`, `old_version`, `new_version`, `target_slot`, `image_size`, `image_digest`,
`rollback_counter`, `allow_downgrade` from the policy, `signing_key` and `staged_at`, a string.
Other types follow `UpdatePlan`, `update_id` being an `UpdateId`. Both live in
`fwctl_core::update`. Journal sits at `staging_file`, resolved from configuration like
`history_file`; `StagingJournal::new` takes that path, `list` gives `Vec<StagedUpdate>`, `get`
gives `Option<StagedUpdate>`, `record` writes one. One record per device, newest replacing
older.

`UpdateEngine::activate` finishes from that record alone: device id, journal, observer. It
consumes the record whatever happens. Nothing staged there is `NothingStaged`. Weigh it against
what the device runs now, not what it ran at staging: another product, a rollback counter the
device has passed, a version it has passed with no downgrade permitted, a different transfer, or
short of the bytes, and it stops with `StagedUpdateLost` before boot state moves. Otherwise
check digest again, set candidate, reboot, health check, confirm, and hand back what `run` hands
back, naming firmware being left. Give both errors an `ErrorCategory` named after them.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
