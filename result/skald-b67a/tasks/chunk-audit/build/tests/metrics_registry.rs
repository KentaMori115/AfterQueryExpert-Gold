//! Counter, gauge and histogram behaviour, including the saturation and
//! ordering promises a report depends on.
//! Graded as inherited behaviour: this file is restored from the base
//! commit before it runs, so edits made alongside a change are ignored.

use skald::metrics::counter::{Kind, Registry};
use skald::metrics::histogram::Histogram;

#[test]
fn a_new_registry_is_empty() {
    let registry = Registry::new();
    assert!(registry.is_empty());
    assert_eq!(registry.len(), 0);
    assert!(registry.value(b"anything").is_none());
    assert!(registry.kind_of(b"anything").is_none());
    assert_eq!(registry.render(), "");
}

#[test]
fn a_counter_accumulates_and_counts_its_writes() {
    let mut registry = Registry::new();
    assert_eq!(registry.incr(b"loads", 1), Some(1));
    assert_eq!(registry.incr(b"loads", 4), Some(5));
    assert_eq!(registry.incr(b"loads", 0), Some(5));
    assert_eq!(registry.value(b"loads"), Some(5));
    assert_eq!(registry.updates(b"loads"), Some(3));
    assert_eq!(registry.kind_of(b"loads"), Some(Kind::Counter));
}

#[test]
fn a_counter_refuses_to_go_backwards() {
    let mut registry = Registry::new();
    registry.incr(b"loads", 10);
    assert_eq!(registry.incr(b"loads", -1), None);
    assert_eq!(registry.value(b"loads"), Some(10), "the refusal changed nothing");
    assert_eq!(registry.updates(b"loads"), Some(1));
}

#[test]
fn a_counter_saturates_rather_than_wrapping() {
    let mut registry = Registry::new();
    registry.incr(b"big", i64::MAX);
    registry.incr(b"big", i64::MAX);
    assert_eq!(registry.value(b"big"), Some(i64::MAX));
}

#[test]
fn a_gauge_moves_in_both_directions() {
    let mut registry = Registry::new();
    assert_eq!(registry.add(b"live", 5), Some(5));
    assert_eq!(registry.add(b"live", -3), Some(2));
    assert_eq!(registry.set(b"live", 100), Some(100));
    assert_eq!(registry.add(b"live", -150), Some(-50));
    assert_eq!(registry.kind_of(b"live"), Some(Kind::Gauge));
}

#[test]
fn a_gauge_saturates_at_both_ends() {
    let mut registry = Registry::new();
    registry.set(b"level", i64::MAX);
    assert_eq!(registry.add(b"level", 1000), Some(i64::MAX));
    registry.set(b"level", i64::MIN);
    assert_eq!(registry.add(b"level", -1000), Some(i64::MIN));
}

#[test]
fn a_name_keeps_the_kind_it_was_registered_under() {
    let mut registry = Registry::new();
    registry.incr(b"loads", 3);
    assert_eq!(registry.add(b"loads", 1), None, "a counter is not a gauge");
    assert_eq!(registry.set(b"loads", 0), None);
    assert_eq!(registry.value(b"loads"), Some(3));
    assert_eq!(registry.kind_of(b"loads"), Some(Kind::Counter));

    registry.set(b"level", 7);
    assert_eq!(registry.incr(b"level", 1), None, "a gauge is not a counter");
    assert_eq!(registry.value(b"level"), Some(7));
}

#[test]
fn registering_an_existing_name_does_not_duplicate_it() {
    let mut registry = Registry::new();
    let first = registry.register(b"loads", Kind::Counter);
    let second = registry.register(b"loads", Kind::Gauge);
    assert_eq!(first, second);
    assert_eq!(registry.len(), 1);
    assert_eq!(registry.kind_of(b"loads"), Some(Kind::Counter));
}

#[test]
fn readings_come_back_in_registration_order() {
    let mut registry = Registry::new();
    registry.incr(b"zeta", 1);
    registry.set(b"alpha", 2);
    registry.incr(b"middle", 3);
    let names: Vec<Vec<u8>> = registry.readings().into_iter().map(|r| r.name).collect();
    assert_eq!(names, vec![b"zeta".to_vec(), b"alpha".to_vec(), b"middle".to_vec()]);
}

#[test]
fn a_prefix_filter_selects_one_subsystem() {
    let mut registry = Registry::new();
    registry.incr(b"gc.collections", 2);
    registry.set(b"gc.live", 9);
    registry.incr(b"vm.steps", 5);
    let gc = registry.readings_with_prefix(b"gc.");
    assert_eq!(gc.len(), 2);
    assert_eq!(gc[0].name, b"gc.collections".to_vec());
    assert_eq!(registry.readings_with_prefix(b"missing.").len(), 0);
    assert_eq!(registry.readings_with_prefix(b"").len(), 3);
}

#[test]
fn resetting_values_keeps_the_names_and_the_write_counts() {
    let mut registry = Registry::new();
    registry.incr(b"loads", 7);
    registry.set(b"live", 3);
    registry.reset_values();
    assert_eq!(registry.len(), 2);
    assert_eq!(registry.value(b"loads"), Some(0));
    assert_eq!(registry.value(b"live"), Some(0));
    assert_eq!(registry.updates(b"loads"), Some(1));
    registry.clear();
    assert!(registry.is_empty());
    assert!(registry.value(b"loads").is_none());
}

#[test]
fn a_rendered_registry_names_the_kind_of_every_record() {
    let mut registry = Registry::new();
    registry.incr(b"loads", 4);
    registry.set(b"live", -2);
    assert_eq!(registry.render(), "counter loads 4\ngauge live -2\n");
}

#[test]
fn an_empty_histogram_answers_nothing() {
    let histogram = Histogram::new();
    assert!(histogram.is_empty());
    assert_eq!(histogram.count(), 0);
    assert_eq!(histogram.sum(), 0);
    assert!(histogram.min().is_none());
    assert!(histogram.max().is_none());
    assert!(histogram.mean().is_none());
    assert!(histogram.median().is_none());
    assert!(histogram.occupied_buckets().is_empty());
    assert_eq!(histogram.render(), "");
}

#[test]
fn zero_gets_a_bucket_of_its_own() {
    assert_eq!(Histogram::bucket_index(0), 0);
    assert_eq!(Histogram::bucket_bounds(0), Some((0, 0)));
    assert_eq!(Histogram::bucket_index(1), 1);
    assert_eq!(Histogram::bucket_bounds(1), Some((1, 1)));
    assert_eq!(Histogram::bucket_index(2), 2);
    assert_eq!(Histogram::bucket_bounds(2), Some((2, 3)));
    assert_eq!(Histogram::bucket_index(u64::MAX), 64);
    assert_eq!(Histogram::bucket_bounds(64), Some((1u64 << 63, u64::MAX)));
    assert_eq!(Histogram::bucket_bounds(65), None);
}

#[test]
fn every_sample_lands_in_the_bucket_that_contains_it() {
    let mut histogram = Histogram::new();
    for sample in [0u64, 1, 2, 3, 4, 100, 1000, u64::MAX] {
        histogram.record(sample);
    }
    for bucket in histogram.occupied_buckets() {
        assert!(bucket.low <= bucket.high);
        assert!(bucket.count > 0);
    }
    assert_eq!(histogram.count(), 8);
    assert_eq!(histogram.min(), Some(0));
    assert_eq!(histogram.max(), Some(u64::MAX));
}

#[test]
fn totals_survive_a_sum_wider_than_the_sample_type() {
    let mut histogram = Histogram::new();
    histogram.record(u64::MAX);
    histogram.record(u64::MAX);
    assert_eq!(histogram.sum(), (u64::MAX as u128) * 2);
    assert_eq!(histogram.count(), 2);
}

#[test]
fn recording_a_sample_many_times_matches_recording_it_singly() {
    let mut once = Histogram::new();
    let mut bulk = Histogram::new();
    for _ in 0..50 {
        once.record(37);
    }
    bulk.record_many(37, 50);
    assert_eq!(once.count(), bulk.count());
    assert_eq!(once.sum(), bulk.sum());
    assert_eq!(once.occupied_buckets(), bulk.occupied_buckets());
    bulk.record_many(9, 0);
    assert_eq!(bulk.count(), 50, "a zero-count record changes nothing");
}

#[test]
fn quantiles_stay_inside_the_recorded_range() {
    let mut histogram = Histogram::new();
    for i in 1..=1000u64 {
        histogram.record(i);
    }
    for q in [0.0, 0.1, 0.5, 0.9, 0.99, 1.0] {
        let value = histogram.quantile(q).expect("a non-empty histogram answers");
        assert!(value >= 1 && value <= 1000, "quantile {q} gave {value}");
    }
    assert!(histogram.quantile(0.9).unwrap() > histogram.quantile(0.1).unwrap());
    assert_eq!(histogram.quantile(-5.0), histogram.quantile(0.0));
    assert_eq!(histogram.quantile(5.0), histogram.quantile(1.0));
}

#[test]
fn a_single_sample_is_its_own_median() {
    let mut histogram = Histogram::new();
    histogram.record(64);
    assert_eq!(histogram.median(), Some(64));
    assert_eq!(histogram.mean(), Some(64.0));
    assert_eq!(histogram.min(), Some(64));
    assert_eq!(histogram.max(), Some(64));
}

#[test]
fn merging_adds_one_histogram_to_another() {
    let mut left = Histogram::new();
    let mut right = Histogram::new();
    for i in 0..10u64 {
        left.record(i);
    }
    for i in 100..110u64 {
        right.record(i);
    }
    left.merge(&right);
    assert_eq!(left.count(), 20);
    assert_eq!(left.min(), Some(0));
    assert_eq!(left.max(), Some(109));
    let empty = Histogram::new();
    let before = left.count();
    left.merge(&empty);
    assert_eq!(left.count(), before, "merging nothing changes nothing");
}

#[test]
fn resetting_a_histogram_forgets_every_sample() {
    let mut histogram = Histogram::new();
    for i in 0..100u64 {
        histogram.record(i);
    }
    histogram.reset();
    assert!(histogram.is_empty());
    assert!(histogram.min().is_none());
    assert!(histogram.max().is_none());
    assert_eq!(histogram.sum(), 0);
    assert_eq!(histogram.bucket_count(3), 0);
}

#[test]
fn a_rendered_histogram_lists_only_occupied_buckets() {
    let mut histogram = Histogram::new();
    histogram.record(0);
    histogram.record(5);
    histogram.record(6);
    let rendered = histogram.render();
    assert_eq!(rendered, "0..0 1\n4..7 2\n");
    assert_eq!(rendered.lines().count(), histogram.occupied_buckets().len());
}
