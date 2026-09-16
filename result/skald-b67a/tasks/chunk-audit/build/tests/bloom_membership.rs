//! Membership guarantees and geometry handling of the Bloom filter.
//! Graded as inherited behaviour: this file is restored from the base
//! commit before it runs, so edits made alongside a change are ignored.

use skald::ds::bloom::{Bloom, MAX_PROBES};

fn key(i: usize) -> Vec<u8> {
    format!("key-{i}").into_bytes()
}

#[test]
fn a_filter_never_denies_a_key_it_holds() {
    let mut filter = Bloom::for_capacity(500, 4);
    for i in 0..500 {
        filter.insert(&key(i));
    }
    for i in 0..500 {
        assert!(filter.contains(&key(i)), "key {i} went missing");
    }
    assert_eq!(filter.inserted(), 500);
}

#[test]
fn an_empty_filter_holds_nothing() {
    let filter = Bloom::new(1024, 3);
    assert_eq!(filter.bits_set(), 0);
    assert_eq!(filter.load(), 0.0);
    assert_eq!(filter.inserted(), 0);
    for i in 0..50 {
        assert!(!filter.contains(&key(i)));
    }
}

#[test]
fn the_first_insert_of_a_key_reports_a_change() {
    let mut filter = Bloom::new(4096, 4);
    assert!(filter.insert(b"alpha"), "a fresh key must set bits");
    assert!(!filter.insert(b"alpha"), "the same key sets nothing new");
    assert_eq!(filter.inserted(), 2, "repeats still count as inserts");
}

#[test]
fn an_empty_key_is_a_key_like_any_other() {
    let mut filter = Bloom::new(512, 3);
    assert!(!filter.contains(b""));
    filter.insert(b"");
    assert!(filter.contains(b""));
}

#[test]
fn the_geometry_is_clamped_into_a_usable_range() {
    let degenerate = Bloom::new(0, 0);
    assert_eq!(degenerate.num_bits(), 1);
    assert_eq!(degenerate.probes(), 1);

    let greedy = Bloom::new(64, MAX_PROBES + 50);
    assert_eq!(greedy.probes(), MAX_PROBES);
}

#[test]
fn a_one_bit_filter_answers_everything_once_it_is_set() {
    let mut filter = Bloom::new(1, 1);
    assert!(!filter.contains(b"anything"));
    filter.insert(b"anything");
    assert!(filter.contains(b"anything"));
    assert!(filter.contains(b"something else"), "a full filter says yes");
    assert_eq!(filter.load(), 1.0);
}

#[test]
fn load_and_error_rate_climb_together() {
    let mut filter = Bloom::new(2048, 3);
    let mut previous_load = 0.0;
    let mut previous_rate = 0.0;
    for round in 0..6 {
        for i in 0..40 {
            filter.insert(&key(round * 40 + i));
        }
        let load = filter.load();
        let rate = filter.false_positive_rate();
        assert!(load >= previous_load, "load fell from {previous_load} to {load}");
        assert!(rate >= previous_rate);
        previous_load = load;
        previous_rate = rate;
    }
    assert!(previous_load > 0.0 && previous_load <= 1.0);
}

#[test]
fn more_probes_set_more_bits_for_the_same_key() {
    let mut narrow = Bloom::new(8192, 1);
    let mut wide = Bloom::new(8192, 8);
    narrow.insert(b"skald");
    wide.insert(b"skald");
    assert_eq!(narrow.bits_set(), 1);
    assert!(wide.bits_set() > narrow.bits_set());
}

#[test]
fn a_union_holds_every_key_from_both_sides() {
    let mut left = Bloom::new(4096, 4);
    let mut right = Bloom::new(4096, 4);
    for i in 0..50 {
        left.insert(&key(i));
    }
    for i in 50..100 {
        right.insert(&key(i));
    }
    assert!(left.union(&right));
    for i in 0..100 {
        assert!(left.contains(&key(i)), "key {i} missing after the union");
    }
    assert_eq!(left.inserted(), 100);
}

#[test]
fn a_union_across_different_geometries_is_refused() {
    let mut a = Bloom::new(4096, 4);
    let wider = Bloom::new(8192, 4);
    let deeper = Bloom::new(4096, 5);
    let before = a.bits_set();
    assert!(!a.union(&wider));
    assert!(!a.union(&deeper));
    assert_eq!(a.bits_set(), before, "a refused union changes nothing");
}

#[test]
fn clearing_returns_the_filter_to_its_empty_state() {
    let mut filter = Bloom::new(1024, 4);
    for i in 0..30 {
        filter.insert(&key(i));
    }
    filter.clear();
    assert_eq!(filter.bits_set(), 0);
    assert_eq!(filter.inserted(), 0);
    assert_eq!(filter.num_bits(), 1024);
    assert_eq!(filter.probes(), 4);
}

#[test]
fn a_filter_rebuilt_from_its_words_answers_the_same_way() {
    let mut filter = Bloom::new(2048, 4);
    for i in 0..60 {
        filter.insert(&key(i));
    }
    let restored = Bloom::from_words(2048, 4, filter.words()).expect("matching geometry");
    for i in 0..60 {
        assert!(restored.contains(&key(i)));
    }
    assert_eq!(restored.bits_set(), filter.bits_set());
    assert_eq!(restored.inserted(), 0, "the insert count is not persisted");
}

#[test]
fn rebuilding_from_the_wrong_word_count_is_refused() {
    let filter = Bloom::new(2048, 4);
    assert!(Bloom::from_words(2048, 4, &filter.words()[..1]).is_none());
    assert!(Bloom::from_words(4096, 4, filter.words()).is_none());
    assert!(Bloom::from_words(0, 4, &[]).is_none());
}

#[test]
fn a_generously_sized_filter_keeps_false_positives_rare() {
    let mut filter = Bloom::for_capacity(1000, 6);
    for i in 0..1000 {
        filter.insert(&key(i));
    }
    let mut hits = 0;
    for i in 1000..3000 {
        if filter.contains(&key(i)) {
            hits += 1;
        }
    }
    assert!(hits < 200, "{hits} of 2000 absent keys reported present");
}
