//! Object lifetime contract of the reference-counted heap and the collector.
//!
//! These drive the raw-pointer API the engine itself uses. Every test builds
//! its own collectors, sets the active context explicitly, and tears both down
//! before it returns, so no scenario inherits another's global state.

use skald::gc::*;
use skald::heap::*;
use skald::value::Value;

unsafe fn as_dict(o: *mut SkObject) -> *mut ObjDict {
    SkObject::as_dict_mut(o).map(|d| d as *mut ObjDict).unwrap()
}

unsafe fn as_array(o: *mut SkObject) -> *mut ObjArray {
    SkObject::as_array_mut(o).map(|a| a as *mut ObjArray).unwrap()
}

/// Run `body` with a single fresh collector installed as the active context.
fn with_collector<F: FnOnce(GcPtr)>(body: F) {
    let gc = gc_create();
    heap_set_gc(gc);
    body(gc);
    heap_set_gc(GcPtr::null());
    gc_destroy(gc);
}

/// Run `body` with two fresh collectors, the first installed as active.
fn with_two_collectors<F: FnOnce(GcPtr, GcPtr)>(body: F) {
    let first = gc_create();
    let second = gc_create();
    heap_set_gc(first);
    body(first, second);
    heap_set_gc(GcPtr::null());
    gc_destroy(second);
    gc_destroy(first);
}

#[test]
fn a_fresh_collector_tracks_nothing() {
    with_collector(|gc| {
        let stats = gc_stats(gc);
        assert_eq!(stats.live_objects, 0);
        assert_eq!(stats.num_collections, 0);
        assert_eq!(stats.total_freed, 0);
    });
}

#[test]
fn tracking_an_object_shows_up_in_the_live_count() {
    with_collector(|gc| {
        assert_eq!(gc_stats(gc).live_objects, 0);
        let s = heap_new_string(b"hello");
        gc_track(gc, s);
        assert_eq!(gc_stats(gc).live_objects, 1, "the tracked object is counted");
        heap_decref(s);
    });
}

#[test]
fn untracking_removes_an_object_from_the_live_count() {
    with_collector(|gc| {
        let s = heap_new_string(b"hello");
        gc_track(gc, s);
        let before = gc_stats(gc).live_objects;
        gc_untrack(gc, s);
        assert_eq!(gc_stats(gc).live_objects, before - 1);
        heap_decref(s);
    });
}

#[test]
fn an_unrooted_object_does_not_survive_a_collection() {
    // Reachability from the roots, not the reference count, decides what a
    // sweep keeps: this object is still referenced here and still goes.
    with_collector(|gc| {
        let s = heap_new_string(b"garbage");
        gc_track(gc, s);
        assert_eq!(gc_stats(gc).live_objects, 1);
        gc_collect(gc);
        let stats = gc_stats(gc);
        assert_eq!(stats.live_objects, 0, "nothing rooted it");
        assert_eq!(stats.num_collections, 1);
    });
}

#[test]
fn a_rooted_object_survives_repeated_collections() {
    with_collector(|gc| {
        let s = heap_new_string(b"kept");
        gc_track(gc, s);
        let mut root = Value::Obj(s);
        gc_add_root(gc, &mut root as *mut Value);
        for round in 1..=5 {
            gc_collect(gc);
            assert_eq!(
                gc_stats(gc).live_objects,
                1,
                "the root should hold through round {round}"
            );
        }
        gc_remove_root(gc, &mut root as *mut Value);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0, "unrooting releases it");
    });
}

#[test]
fn a_rooted_graph_keeps_everything_it_reaches() {
    with_collector(|gc| {
        let root_dict = heap_new_dict();
        gc_track(gc, root_dict);
        let child = heap_new_array();
        gc_track(gc, child);
        let leaf = heap_new_string(b"leaf");
        gc_track(gc, leaf);
        unsafe {
            array_push(as_array(child), Value::Obj(leaf));
            dict_set(as_dict(root_dict), b"child", Value::Obj(child));
        }
        heap_decref(child);
        heap_decref(leaf);

        let mut root = Value::Obj(root_dict);
        gc_add_root(gc, &mut root as *mut Value);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 3, "the whole reachable set holds");

        gc_remove_root(gc, &mut root as *mut Value);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn a_cycle_no_one_roots_is_collected() {
    with_collector(|gc| {
        let a = heap_new_dict();
        let b = heap_new_dict();
        gc_track(gc, a);
        gc_track(gc, b);
        unsafe {
            dict_set(as_dict(a), b"peer", Value::Obj(b));
            dict_set(as_dict(b), b"peer", Value::Obj(a));
        }
        heap_decref(a);
        heap_decref(b);
        assert_eq!(gc_stats(gc).live_objects, 2);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0, "the cycle is unreachable");
    });
}

#[test]
fn a_closures_captured_value_is_reachable_through_it() {
    with_collector(|gc| {
        let captured = heap_new_array();
        gc_track(gc, captured);
        let closure = heap_new_closure(0, Value::Obj(captured));
        gc_track(gc, closure);
        heap_decref(captured);

        let mut root = Value::Obj(closure);
        gc_add_root(gc, &mut root as *mut Value);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 2, "the capture is held too");
        gc_remove_root(gc, &mut root as *mut Value);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn a_paused_collector_frees_nothing() {
    with_collector(|gc| {
        let s = heap_new_string(b"garbage");
        gc_track(gc, s);
        gc_pause(gc);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 1, "a pause suspends collection");
        gc_resume(gc);
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn a_needed_collection_respects_the_threshold() {
    with_collector(|gc| {
        gc_set_threshold(gc, usize::MAX);
        let s = heap_new_string(b"garbage");
        gc_track(gc, s);
        gc_collect_if_needed(gc);
        assert_eq!(
            gc_stats(gc).num_collections,
            0,
            "nothing is due under an unreachable threshold"
        );
        gc_set_threshold(gc, 1);
        gc_collect_if_needed(gc);
        assert!(gc_stats(gc).num_collections >= 1, "a low threshold triggers one");
    });
}

#[test]
fn statistics_accumulate_across_collections() {
    with_collector(|gc| {
        for _ in 0..4 {
            let s = heap_new_string(b"round");
            gc_track(gc, s);
            gc_collect(gc);
        }
        let stats = gc_stats(gc);
        assert_eq!(stats.num_collections, 4);
        assert!(stats.total_allocated >= stats.total_freed);
        assert_eq!(stats.live_objects, 0);
    });
}

#[test]
fn an_incremental_collector_still_reaches_a_fixed_point() {
    with_collector(|gc| {
        gc_set_incremental(gc, true);
        gc_set_step_budget(gc, 1);
        let root_dict = heap_new_dict();
        gc_track(gc, root_dict);
        for i in 0..8 {
            let child = heap_new_array();
            gc_track(gc, child);
            let key = [b'k', b'0' + i as u8];
            unsafe { dict_set(as_dict(root_dict), &key, Value::Obj(child)) };
            heap_decref(child);
        }
        let mut root = Value::Obj(root_dict);
        gc_add_root(gc, &mut root as *mut Value);
        for _ in 0..20 {
            gc_collect(gc);
        }
        assert_eq!(gc_stats(gc).live_objects, 9, "the rooted graph is intact");
        gc_remove_root(gc, &mut root as *mut Value);
        for _ in 0..20 {
            gc_collect(gc);
        }
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn stepping_terminates_on_a_graph_it_cannot_finish_in_one_budget() {
    with_collector(|gc| {
        gc_set_incremental(gc, true);
        gc_set_step_budget(gc, 2);
        let head = heap_new_array();
        gc_track(gc, head);
        let mut previous = head;
        for _ in 0..30 {
            let next = heap_new_array();
            gc_track(gc, next);
            unsafe { array_push(as_array(previous), Value::Obj(next)) };
            heap_decref(next);
            previous = next;
        }
        let mut root = Value::Obj(head);
        gc_add_root(gc, &mut root as *mut Value);
        for _ in 0..100 {
            gc_step(gc);
        }
        assert_eq!(gc_stats(gc).live_objects, 31);
        gc_remove_root(gc, &mut root as *mut Value);
    });
}

#[test]
fn forcing_a_mark_pins_a_whole_subgraph() {
    with_collector(|gc| {
        let parent = heap_new_dict();
        gc_track(gc, parent);
        let child = heap_new_string(b"pinned");
        gc_track(gc, child);
        unsafe { dict_set(as_dict(parent), b"child", Value::Obj(child)) };
        heap_decref(child);
        gc_force_mark_object(gc, parent);
        assert_eq!(gc_stats(gc).live_objects, 2, "marking does not free");
        gc_collect(gc);
        assert_eq!(gc_stats(gc).live_objects, 0, "a mark is not a root");
    });
}

#[test]
fn a_write_barrier_on_an_untracked_parent_is_harmless() {
    with_collector(|gc| {
        let parent = heap_new_dict();
        let child = heap_new_string(b"child");
        gc_write_barrier(gc, parent, Value::Obj(child));
        gc_write_barrier(gc, std::ptr::null_mut(), Value::Null);
        heap_decref(child);
        heap_decref(parent);
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn reclaiming_an_object_untracks_it_from_the_collector_that_owns_it() {
    // The regression this file exists for: an object tracked by one collector
    // and released while a different collector is the active context must be
    // taken out of its own collector's list, not the active one's.
    with_two_collectors(|first, second| {
        let owned = heap_new_string(b"owned by the first collector");
        gc_track(first, owned);
        assert_eq!(gc_stats(first).live_objects, 1);
        assert_eq!(gc_stats(second).live_objects, 0);

        heap_set_gc(second);
        heap_decref(owned);
        heap_set_gc(first);

        assert_eq!(
            gc_stats(first).live_objects,
            0,
            "the owning collector should have dropped it"
        );
        assert_eq!(gc_stats(second).live_objects, 0);
        gc_collect(first);
        gc_collect(second);
    });
}

#[test]
fn a_chain_released_under_a_foreign_context_still_collects() {
    with_two_collectors(|first, second| {
        let root_dict = heap_new_dict();
        gc_track(first, root_dict);
        let middle = heap_new_array();
        gc_track(first, middle);
        let leaf = heap_new_dict();
        gc_track(first, leaf);
        unsafe {
            array_push(as_array(middle), Value::Obj(leaf));
            dict_set(as_dict(root_dict), b"middle", Value::Obj(middle));
        }
        heap_decref(middle);

        let mut root = Value::Obj(root_dict);
        gc_add_root(first, &mut root as *mut Value);
        gc_collect(first);

        heap_set_gc(second);
        heap_decref(leaf);
        heap_set_gc(first);

        gc_collect(first);
        gc_collect(second);
        gc_remove_root(first, &mut root as *mut Value);
        gc_collect(first);
        assert_eq!(gc_stats(first).live_objects, 0);
        assert_eq!(gc_stats(second).live_objects, 0);
    });
}

#[test]
fn two_collectors_keep_separate_accounts() {
    with_two_collectors(|first, second| {
        let a = heap_new_string(b"first");
        gc_track(first, a);
        let b = heap_new_string(b"second");
        gc_track(second, b);

        assert_eq!(gc_stats(first).live_objects, 1);
        assert_eq!(gc_stats(second).live_objects, 1);
        gc_collect(first);
        assert_eq!(gc_stats(first).live_objects, 0);
        assert_eq!(
            gc_stats(second).live_objects,
            1,
            "collecting one does not touch the other"
        );
        gc_collect(second);
        assert_eq!(gc_stats(second).live_objects, 0);
    });
}

#[test]
fn the_null_handle_is_accepted_everywhere() {
    let null = GcPtr::null();
    assert!(null.is_null());
    gc_track(null, std::ptr::null_mut());
    gc_untrack(null, std::ptr::null_mut());
    gc_collect(null);
    gc_step(null);
    gc_pause(null);
    gc_resume(null);
    gc_set_threshold(null, 10);
    gc_set_step_budget(null, 2);
    gc_set_incremental(null, true);
    gc_force_mark_object(null, std::ptr::null_mut());
    gc_mark_value(null, Value::Null);
    let stats = gc_stats(null);
    assert_eq!(stats.live_objects, 0);
    assert_eq!(stats.num_collections, 0);
}

#[test]
fn tracking_a_null_object_changes_nothing() {
    with_collector(|gc| {
        gc_track(gc, std::ptr::null_mut());
        gc_untrack(gc, std::ptr::null_mut());
        gc_force_mark_object(gc, std::ptr::null_mut());
        assert_eq!(gc_stats(gc).live_objects, 0);
    });
}

#[test]
fn an_object_size_is_reported_for_every_kind() {
    with_collector(|_| {
        let string = heap_new_string(b"abcdef");
        let array = heap_new_array();
        let dict = heap_new_dict();
        let closure = heap_new_closure(3, Value::Int(1));
        for obj in [string, array, dict, closure] {
            assert!(gc_object_size(obj) > 0, "every object has a size");
        }
        assert_eq!(gc_object_size(std::ptr::null_mut()), 0);
        for obj in [string, array, dict, closure] {
            heap_decref(obj);
        }
    });
}
