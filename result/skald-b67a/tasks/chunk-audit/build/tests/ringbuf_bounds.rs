//! Capacity, eviction and ordering contract of the fixed-capacity ring.
//! Graded as inherited behaviour: this file is restored from the base
//! commit before it runs, so edits made alongside a change are ignored.

use skald::ds::ringbuf::{Overflow, PushResult, RingBuf};
use skald::value::Value;

fn ints(ring: &RingBuf) -> Vec<i64> {
    ring.to_vec()
        .into_iter()
        .map(|v| match v {
            Value::Int(i) => i,
            other => panic!("expected an int, got {:?}", other.type_of()),
        })
        .collect()
}

#[test]
fn a_new_ring_is_empty_at_its_capacity() {
    let ring = RingBuf::new(4, Overflow::Reject);
    assert_eq!(ring.capacity(), 4);
    assert_eq!(ring.len(), 0);
    assert!(ring.is_empty());
    assert!(!ring.is_full());
    assert_eq!(ring.evicted(), 0);
    assert_eq!(ring.policy(), Overflow::Reject);
    assert!(ring.front().is_none());
    assert!(ring.back().is_none());
}

#[test]
fn values_come_back_oldest_first() {
    let mut ring = RingBuf::new(4, Overflow::Reject);
    for i in 0..4 {
        assert_eq!(ring.push(Value::Int(i)), PushResult::Stored);
    }
    assert_eq!(ints(&ring), vec![0, 1, 2, 3]);
    assert!(ring.is_full());
    assert!(matches!(ring.front(), Some(Value::Int(0))));
    assert!(matches!(ring.back(), Some(Value::Int(3))));
}

#[test]
fn a_rejecting_ring_refuses_and_keeps_its_contents() {
    let mut ring = RingBuf::new(2, Overflow::Reject);
    ring.push(Value::Int(1));
    ring.push(Value::Int(2));
    let before = ints(&ring);
    assert_eq!(ring.push(Value::Int(3)), PushResult::Rejected);
    assert_eq!(ints(&ring), before);
    assert_eq!(ring.len(), 2);
    assert_eq!(ring.evicted(), 0, "a rejected push evicts nothing");
}

#[test]
fn an_overwriting_ring_drops_the_oldest_entry() {
    let mut ring = RingBuf::new(3, Overflow::Overwrite);
    for i in 0..3 {
        ring.push(Value::Int(i));
    }
    assert_eq!(ring.evicted(), 0);
    assert_eq!(ring.push(Value::Int(3)), PushResult::Evicted);
    assert_eq!(ints(&ring), vec![1, 2, 3]);
    assert_eq!(ring.len(), 3, "the length holds at the capacity");
    assert_eq!(ring.evicted(), 1);
}

#[test]
fn a_long_overwriting_run_keeps_only_the_newest_window() {
    let mut ring = RingBuf::new(4, Overflow::Overwrite);
    for i in 0..100 {
        ring.push(Value::Int(i));
    }
    assert_eq!(ints(&ring), vec![96, 97, 98, 99]);
    assert_eq!(ring.evicted(), 96);
}

#[test]
fn popping_and_pushing_wraps_without_reordering() {
    let mut ring = RingBuf::new(3, Overflow::Reject);
    ring.push(Value::Int(1));
    ring.push(Value::Int(2));
    ring.push(Value::Int(3));
    assert!(matches!(ring.pop(), Some(Value::Int(1))));
    assert_eq!(ring.push(Value::Int(4)), PushResult::Stored);
    assert_eq!(ints(&ring), vec![2, 3, 4]);
    assert!(matches!(ring.pop(), Some(Value::Int(2))));
    assert!(matches!(ring.pop(), Some(Value::Int(3))));
    assert!(matches!(ring.pop(), Some(Value::Int(4))));
    assert!(ring.pop().is_none());
}

#[test]
fn indexing_counts_from_the_oldest_and_stops_at_the_length() {
    let mut ring = RingBuf::new(4, Overflow::Overwrite);
    for i in 0..6 {
        ring.push(Value::Int(i));
    }
    assert!(matches!(ring.get(0), Some(Value::Int(2))));
    assert!(matches!(ring.get(3), Some(Value::Int(5))));
    assert!(ring.get(4).is_none());
    assert!(ring.get(usize::MAX).is_none());
}

#[test]
fn clearing_keeps_the_capacity_and_the_eviction_total() {
    let mut ring = RingBuf::new(2, Overflow::Overwrite);
    for i in 0..5 {
        ring.push(Value::Int(i));
    }
    let evicted = ring.evicted();
    assert_eq!(evicted, 3);
    ring.clear();
    assert!(ring.is_empty());
    assert_eq!(ring.capacity(), 2);
    assert_eq!(ring.evicted(), evicted, "clearing is not an eviction");
    assert_eq!(ring.push(Value::Int(9)), PushResult::Stored);
}

#[test]
fn dropping_the_front_reports_what_it_actually_took() {
    let mut ring = RingBuf::new(5, Overflow::Reject);
    for i in 0..5 {
        ring.push(Value::Int(i));
    }
    assert_eq!(ring.drop_front(2), 2);
    assert_eq!(ints(&ring), vec![2, 3, 4]);
    assert_eq!(ring.drop_front(10), 3, "it cannot drop more than it holds");
    assert!(ring.is_empty());
    assert_eq!(ring.drop_front(1), 0);
}

#[test]
fn growing_keeps_every_value_in_order() {
    let mut ring = RingBuf::new(3, Overflow::Overwrite);
    for i in 0..5 {
        ring.push(Value::Int(i));
    }
    assert_eq!(ints(&ring), vec![2, 3, 4]);
    let evicted = ring.evicted();
    ring.resize(6);
    assert_eq!(ring.capacity(), 6);
    assert_eq!(ints(&ring), vec![2, 3, 4]);
    assert_eq!(ring.evicted(), evicted, "growing drops nothing");
    ring.push(Value::Int(5));
    assert_eq!(ints(&ring), vec![2, 3, 4, 5]);
}

#[test]
fn shrinking_keeps_the_newest_values_and_counts_the_rest_as_evicted() {
    let mut ring = RingBuf::new(5, Overflow::Reject);
    for i in 0..5 {
        ring.push(Value::Int(i));
    }
    assert_eq!(ring.evicted(), 0);
    ring.resize(2);
    assert_eq!(ring.capacity(), 2);
    assert_eq!(ints(&ring), vec![3, 4]);
    assert_eq!(ring.evicted(), 3, "the three dropped values are counted");
}

#[test]
fn a_zero_capacity_ring_answers_by_its_policy() {
    let mut rejecting = RingBuf::new(0, Overflow::Reject);
    assert_eq!(rejecting.push(Value::Int(1)), PushResult::Rejected);
    assert!(rejecting.is_empty());
    assert!(rejecting.is_full(), "zero of zero slots are free");
    assert_eq!(rejecting.evicted(), 0);

    let mut overwriting = RingBuf::new(0, Overflow::Overwrite);
    assert_eq!(overwriting.push(Value::Int(1)), PushResult::Evicted);
    assert!(overwriting.is_empty());
    assert_eq!(overwriting.evicted(), 1);
    assert!(overwriting.pop().is_none());
}

#[test]
fn mixed_value_kinds_survive_a_wrap() {
    let mut ring = RingBuf::new(3, Overflow::Overwrite);
    ring.push(Value::Int(1));
    ring.push(Value::Float(2.5));
    ring.push(Value::Null);
    ring.push(Value::Int(4));
    let live = ring.to_vec();
    assert!(matches!(live[0], Value::Float(f) if f == 2.5));
    assert!(live[1].is_null());
    assert!(matches!(live[2], Value::Int(4)));
}
