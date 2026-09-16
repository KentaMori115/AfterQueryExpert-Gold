//! Collector health reporting — part of the `diag` subsystem.
//!
//! Everything here reads the collector through [`crate::gc::gc_stats`] and
//! never mutates it, so a report can be taken at any point in a program's life
//! without changing what the next collection does.

use crate::gc::{gc_stats, GcPtr, GcStats};
use crate::metrics::counter::{Kind, Registry};

/// How healthy a reading looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Health {
    /// Nothing to say.
    Ok,
    /// Worth watching, but not yet wrong.
    Warn,
    /// The reading contradicts something the collector promises.
    Bad,
}

/// One named observation about a collector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub check: &'static str,
    pub health: Health,
    pub detail: String,
}

/// The whole picture for one collector at one instant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub findings: Vec<Finding>,
}

impl Report {
    /// The worst health any check reported, or [`Health::Ok`] for an empty
    /// report.
    pub fn worst(&self) -> Health {
        self.findings
            .iter()
            .map(|f| f.health)
            .max()
            .unwrap_or(Health::Ok)
    }

    /// True when nothing rose above [`Health::Ok`].
    pub fn is_clean(&self) -> bool {
        self.worst() == Health::Ok
    }

    /// Findings at exactly `health`, in check order.
    pub fn at(&self, health: Health) -> Vec<&Finding> {
        self.findings.iter().filter(|f| f.health == health).collect()
    }

    /// The finding for `check`, if that check ran.
    pub fn find(&self, check: &str) -> Option<&Finding> {
        self.findings.iter().find(|f| f.check == check)
    }

    /// One line per finding: `health check detail`.
    pub fn render(&self) -> String {
        let mut out = String::new();
        for f in &self.findings {
            let tag = match f.health {
                Health::Ok => "ok",
                Health::Warn => "warn",
                Health::Bad => "bad",
            };
            out.push_str(tag);
            out.push(' ');
            out.push_str(f.check);
            out.push(' ');
            out.push_str(&f.detail);
            out.push('\n');
        }
        out
    }
}

fn finding(check: &'static str, health: Health, detail: String) -> Finding {
    Finding {
        check,
        health,
        detail,
    }
}

/// Audit a set of statistics without needing the collector they came from.
///
/// The checks, in the order they appear in the report:
///
/// - `freed_vs_allocated` — a collector cannot have freed more than it
///   allocated.
/// - `live_accounting` — live objects plus freed objects should not exceed
///   what was allocated.
/// - `collection_progress` — a collector that has run at least once and still
///   freed nothing is worth a look.
/// - `threshold_headroom` — how close the live set is to the collection
///   threshold.
/// - `collection_recency` — whether a collection has ever been timed.
pub fn audit_stats(stats: &GcStats) -> Report {
    let mut findings = Vec::new();

    findings.push(if stats.total_freed > stats.total_allocated {
        finding(
            "freed_vs_allocated",
            Health::Bad,
            format!(
                "freed {} of {} allocated",
                stats.total_freed, stats.total_allocated
            ),
        )
    } else {
        finding(
            "freed_vs_allocated",
            Health::Ok,
            format!(
                "freed {} of {} allocated",
                stats.total_freed, stats.total_allocated
            ),
        )
    });

    let accounted = stats.total_freed.saturating_add(stats.live_objects);
    findings.push(if accounted > stats.total_allocated {
        finding(
            "live_accounting",
            Health::Bad,
            format!(
                "{} live plus {} freed exceeds {} allocated",
                stats.live_objects, stats.total_freed, stats.total_allocated
            ),
        )
    } else {
        finding(
            "live_accounting",
            Health::Ok,
            format!("{} live, {} unaccounted", stats.live_objects, stats.total_allocated - accounted),
        )
    });

    findings.push(if stats.num_collections > 0 && stats.total_freed == 0 && stats.total_allocated > 0
    {
        finding(
            "collection_progress",
            Health::Warn,
            format!("{} collections freed nothing", stats.num_collections),
        )
    } else {
        finding(
            "collection_progress",
            Health::Ok,
            format!("{} collections", stats.num_collections),
        )
    });

    findings.push(if stats.threshold == 0 {
        finding(
            "threshold_headroom",
            Health::Warn,
            "no threshold set".to_string(),
        )
    } else if stats.live_objects >= stats.threshold {
        finding(
            "threshold_headroom",
            Health::Warn,
            format!("{} live at threshold {}", stats.live_objects, stats.threshold),
        )
    } else {
        finding(
            "threshold_headroom",
            Health::Ok,
            format!(
                "{} of {} used",
                stats.live_objects, stats.threshold
            ),
        )
    });

    findings.push(if stats.num_collections > 0 && stats.last_collection_ns == 0 {
        finding(
            "collection_recency",
            Health::Warn,
            "collections ran but none were timed".to_string(),
        )
    } else {
        finding(
            "collection_recency",
            Health::Ok,
            format!("last collection at {}", stats.last_collection_ns),
        )
    });

    Report { findings }
}

/// Audit a live collector. A null handle produces a single `Bad` finding
/// rather than an empty report, so a caller cannot mistake "nothing to check"
/// for "nothing wrong".
pub fn audit(gc: GcPtr) -> Report {
    if gc.is_null() {
        return Report {
            findings: vec![finding(
                "collector_present",
                Health::Bad,
                "null collector handle".to_string(),
            )],
        };
    }
    audit_stats(&gc_stats(gc))
}

/// Copy a collector's statistics into a metrics registry under `prefix`.
///
/// Counters take the cumulative totals; gauges take the readings that can move
/// in either direction. The registry is returned so a caller can fold several
/// collectors into one report.
pub fn record_stats(registry: &mut Registry, prefix: &[u8], stats: &GcStats) {
    let name = |suffix: &str| {
        let mut n = prefix.to_vec();
        n.extend_from_slice(suffix.as_bytes());
        n
    };
    registry.register(&name("allocated"), Kind::Counter);
    registry.register(&name("freed"), Kind::Counter);
    registry.register(&name("collections"), Kind::Counter);
    registry.set(&name("live"), stats.live_objects as i64);
    registry.set(&name("threshold"), stats.threshold as i64);
    let allocated = registry.value(&name("allocated")).unwrap_or(0);
    let freed = registry.value(&name("freed")).unwrap_or(0);
    let collections = registry.value(&name("collections")).unwrap_or(0);
    registry.incr(
        &name("allocated"),
        (stats.total_allocated as i64 - allocated).max(0),
    );
    registry.incr(&name("freed"), (stats.total_freed as i64 - freed).max(0));
    registry.incr(
        &name("collections"),
        (stats.num_collections as i64 - collections).max(0),
    );
}
