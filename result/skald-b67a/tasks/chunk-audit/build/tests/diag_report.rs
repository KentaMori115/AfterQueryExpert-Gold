//! Collector health reporting: what each check says, and that taking a report
//! never disturbs the collector it read.
//! Graded as inherited behaviour: this file is restored from the base
//! commit before it runs, so edits made alongside a change are ignored.

use skald::diag::report::{audit, audit_stats, record_stats, Health};
use skald::gc::{gc_collect, gc_create, gc_destroy, gc_set_threshold, gc_stats, gc_track, GcPtr, GcStats};
use skald::heap::{heap_new_string, heap_set_gc};
use skald::metrics::counter::{Kind, Registry};

fn with_collector<F: FnOnce(GcPtr)>(body: F) {
    let gc = gc_create();
    heap_set_gc(gc);
    body(gc);
    heap_set_gc(GcPtr::null());
    gc_destroy(gc);
}

fn stats(allocated: usize, freed: usize, collections: usize, live: usize) -> GcStats {
    GcStats {
        total_allocated: allocated,
        total_freed: freed,
        num_collections: collections,
        live_objects: live,
        threshold: 1024,
        last_collection_ns: 1,
    }
}

#[test]
fn a_fresh_collector_reports_clean() {
    with_collector(|gc| {
        let report = audit(gc);
        assert!(report.is_clean(), "a new collector has nothing wrong: {}", report.render());
        assert_eq!(report.worst(), Health::Ok);
        assert_eq!(report.findings.len(), 5, "every check runs");
    });
}

#[test]
fn a_null_handle_is_a_finding_not_an_empty_report() {
    let report = audit(GcPtr::null());
    assert_eq!(report.findings.len(), 1);
    assert_eq!(report.worst(), Health::Bad);
    assert_eq!(report.findings[0].check, "collector_present");
    assert!(!report.is_clean());
}

#[test]
fn every_check_is_named_once_and_findable() {
    let report = audit_stats(&stats(10, 2, 1, 3));
    for check in [
        "freed_vs_allocated",
        "live_accounting",
        "collection_progress",
        "threshold_headroom",
        "collection_recency",
    ] {
        assert!(report.find(check).is_some(), "{check} should be reported");
    }
    assert!(report.find("no_such_check").is_none());
}

#[test]
fn freeing_more_than_was_allocated_is_bad() {
    let report = audit_stats(&stats(4, 9, 1, 0));
    let finding = report.find("freed_vs_allocated").unwrap();
    assert_eq!(finding.health, Health::Bad);
    assert_eq!(report.worst(), Health::Bad);
    assert!(finding.detail.contains("9"));
}

#[test]
fn live_plus_freed_beyond_the_allocation_total_is_bad() {
    let report = audit_stats(&stats(10, 6, 1, 8));
    assert_eq!(report.find("live_accounting").unwrap().health, Health::Bad);
}

#[test]
fn balanced_accounting_reports_the_unaccounted_remainder() {
    let report = audit_stats(&stats(10, 6, 1, 3));
    let finding = report.find("live_accounting").unwrap();
    assert_eq!(finding.health, Health::Ok);
    assert!(finding.detail.contains('1'), "10 - 6 - 3 is left over");
}

#[test]
fn collections_that_free_nothing_are_worth_a_warning() {
    let report = audit_stats(&stats(10, 0, 3, 10));
    assert_eq!(report.find("collection_progress").unwrap().health, Health::Warn);
    assert_eq!(report.worst(), Health::Warn, "a warning is not a failure");

    let never_ran = audit_stats(&stats(10, 0, 0, 10));
    assert_eq!(
        never_ran.find("collection_progress").unwrap().health,
        Health::Ok,
        "a collector that never ran has freed nothing for a good reason"
    );
}

#[test]
fn a_live_set_at_the_threshold_is_worth_a_warning() {
    let mut at_limit = stats(100, 0, 0, 50);
    at_limit.threshold = 50;
    assert_eq!(
        audit_stats(&at_limit).find("threshold_headroom").unwrap().health,
        Health::Warn
    );

    let mut unset = stats(100, 0, 0, 1);
    unset.threshold = 0;
    let finding = audit_stats(&unset);
    let headroom = finding.find("threshold_headroom").unwrap();
    assert_eq!(headroom.health, Health::Warn);
    assert!(headroom.detail.contains("no threshold"));
}

#[test]
fn an_untimed_collection_is_worth_a_warning() {
    let mut untimed = stats(10, 4, 2, 1);
    untimed.last_collection_ns = 0;
    assert_eq!(
        audit_stats(&untimed).find("collection_recency").unwrap().health,
        Health::Warn
    );
}

#[test]
fn findings_can_be_selected_by_health() {
    let report = audit_stats(&stats(4, 9, 3, 0));
    assert!(!report.at(Health::Bad).is_empty());
    assert_eq!(
        report.at(Health::Ok).len() + report.at(Health::Warn).len() + report.at(Health::Bad).len(),
        report.findings.len()
    );
}

#[test]
fn a_rendered_report_has_one_line_per_finding() {
    let report = audit_stats(&stats(10, 2, 1, 3));
    let rendered = report.render();
    assert_eq!(rendered.lines().count(), report.findings.len());
    for line in rendered.lines() {
        assert!(
            line.starts_with("ok ") || line.starts_with("warn ") || line.starts_with("bad "),
            "unexpected line: {line}"
        );
    }
}

#[test]
fn auditing_a_collector_does_not_change_it() {
    with_collector(|gc| {
        let s = heap_new_string(b"held");
        gc_track(gc, s);
        gc_collect(gc);
        let before = gc_stats(gc);
        for _ in 0..5 {
            let _ = audit(gc);
        }
        let after = gc_stats(gc);
        assert_eq!(before.num_collections, after.num_collections);
        assert_eq!(before.live_objects, after.live_objects);
        assert_eq!(before.total_freed, after.total_freed);
    });
}

#[test]
fn a_live_collector_under_a_tight_threshold_reports_the_pressure() {
    with_collector(|gc| {
        gc_set_threshold(gc, 1);
        gc_collect(gc); // publishes the threshold into the statistics
        let s = heap_new_string(b"held");
        gc_track(gc, s);
        let report = audit(gc);
        assert_eq!(report.find("threshold_headroom").unwrap().health, Health::Warn);
    });
}

#[test]
fn recording_statistics_registers_counters_and_gauges_under_one_prefix() {
    let mut registry = Registry::new();
    record_stats(&mut registry, b"gc.", &stats(100, 40, 3, 12));
    assert_eq!(registry.value(b"gc.allocated"), Some(100));
    assert_eq!(registry.value(b"gc.freed"), Some(40));
    assert_eq!(registry.value(b"gc.collections"), Some(3));
    assert_eq!(registry.value(b"gc.live"), Some(12));
    assert_eq!(registry.kind_of(b"gc.allocated"), Some(Kind::Counter));
    assert_eq!(registry.kind_of(b"gc.live"), Some(Kind::Gauge));
    assert_eq!(registry.readings_with_prefix(b"gc.").len(), 5);
}

#[test]
fn recording_twice_advances_the_counters_by_the_difference() {
    let mut registry = Registry::new();
    record_stats(&mut registry, b"gc.", &stats(100, 40, 3, 12));
    record_stats(&mut registry, b"gc.", &stats(180, 90, 5, 7));
    assert_eq!(registry.value(b"gc.allocated"), Some(180));
    assert_eq!(registry.value(b"gc.freed"), Some(90));
    assert_eq!(registry.value(b"gc.collections"), Some(5));
    assert_eq!(registry.value(b"gc.live"), Some(7), "the gauge follows the reading down");
}

#[test]
fn a_reading_that_moves_backwards_leaves_the_counters_where_they_are() {
    let mut registry = Registry::new();
    record_stats(&mut registry, b"gc.", &stats(100, 40, 3, 12));
    record_stats(&mut registry, b"gc.", &stats(50, 10, 1, 2));
    assert_eq!(registry.value(b"gc.allocated"), Some(100), "counters do not fall");
    assert_eq!(registry.value(b"gc.freed"), Some(40));
    assert_eq!(registry.value(b"gc.collections"), Some(3));
    assert_eq!(registry.value(b"gc.live"), Some(2));
}

#[test]
fn two_collectors_can_share_one_registry_under_different_prefixes() {
    let mut registry = Registry::new();
    record_stats(&mut registry, b"first.", &stats(100, 40, 3, 12));
    record_stats(&mut registry, b"second.", &stats(9, 1, 1, 8));
    assert_eq!(registry.len(), 10);
    assert_eq!(registry.value(b"first.live"), Some(12));
    assert_eq!(registry.value(b"second.live"), Some(8));
    assert_eq!(registry.readings_with_prefix(b"second.").len(), 5);
}
