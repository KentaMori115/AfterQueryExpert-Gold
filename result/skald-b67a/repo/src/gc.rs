//! Tri-color mark-and-sweep garbage collector — a faithful port of `gc.c`.
//!
//! Every heap object is enrolled with [`gc_track`]. The collector keeps a
//! doubly-linked list of [`GcNode`] wrappers and a gray work-queue. Roots are
//! registered explicitly (or via a root scanner). [`gc_collect`] paints
//! everything white, grays the roots, drains the gray queue marking reachable
//! objects black, then sweeps the remaining white objects.

use crate::heap::{ObjBody, SkObject};
use crate::value::Value;
use std::os::raw::c_void;
use std::ptr;

pub const GC_COLOR_WHITE: u8 = 0;
pub const GC_COLOR_GRAY: u8 = 1;
pub const GC_COLOR_BLACK: u8 = 2;

fn gc_now_ns() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

#[derive(Default, Clone, Copy)]
pub struct GcStats {
    pub total_allocated: usize,
    pub total_freed: usize,
    pub num_collections: usize,
    pub live_objects: usize,
    pub threshold: usize,
    pub last_collection_ns: u64,
}

#[repr(C)]
pub struct GcNode {
    pub obj: *mut SkObject,
    pub color: u8,
    pub obj_size: usize,
    pub prev: *mut GcNode,
    pub next: *mut GcNode,
}

pub struct RootEntry {
    pub ptr: *mut Value,
    pub next: *mut RootEntry,
}

/// Gray work-queue implemented as a circular ring buffer, mirroring the C code.
pub struct GrayQueue {
    items: Vec<*mut GcNode>,
    head: usize,
    tail: usize,
    cap: usize,
}

impl GrayQueue {
    const INIT_CAP: usize = 256;

    fn new() -> GrayQueue {
        GrayQueue {
            items: vec![ptr::null_mut(); Self::INIT_CAP],
            head: 0,
            tail: 0,
            cap: Self::INIT_CAP,
        }
    }
    fn size(&self) -> usize {
        (self.tail + self.cap - self.head) % self.cap
    }
    fn is_empty(&self) -> bool {
        self.head == self.tail
    }
    fn grow(&mut self) {
        let new_cap = self.cap * 2;
        let mut new_items = vec![ptr::null_mut(); new_cap];
        let size = self.size();
        for i in 0..size {
            new_items[i] = self.items[(self.head + i) % self.cap];
        }
        self.items = new_items;
        self.head = 0;
        self.tail = size;
        self.cap = new_cap;
    }
    fn push(&mut self, n: *mut GcNode) {
        let mut next = (self.tail + 1) % self.cap;
        if next == self.head {
            self.grow();
            next = (self.tail + 1) % self.cap;
        }
        self.items[self.tail] = n;
        self.tail = next;
    }
    fn pop(&mut self) -> *mut GcNode {
        if self.is_empty() {
            return ptr::null_mut();
        }
        let n = self.items[self.head];
        self.head = (self.head + 1) % self.cap;
        n
    }
}

pub type RootScanner = fn(GcPtr, *mut c_void);

pub struct Gc {
    pub list_head: *mut GcNode,
    pub list_tail: *mut GcNode,
    pub object_count: usize,
    pub bytes_allocated: usize,

    pub roots: *mut RootEntry,
    pub root_count: usize,

    pub gray: GrayQueue,

    pub threshold: usize,
    pub paused: bool,

    pub stats: GcStats,

    pub incremental: bool,
    pub step_budget: i32,
    pub marking_in_progress: bool,

    pub barrier_log: Vec<*mut GcNode>,

    pub root_scanner: Option<RootScanner>,
    pub root_scanner_data: *mut c_void,
}

/// Thin newtype over a raw `*mut Gc`, so the heap can hold a null-able GC handle
/// (mirroring the C `g_gc` global) without exposing lifetime plumbing.
#[derive(Clone, Copy)]
pub struct GcPtr(pub *mut Gc);

impl GcPtr {
    pub const fn null() -> GcPtr {
        GcPtr(ptr::null_mut())
    }
    pub fn is_null(&self) -> bool {
        self.0.is_null()
    }
    #[inline]
    unsafe fn r(&self) -> &mut Gc {
        &mut *self.0
    }
}

// ── object size estimation ──────────────────────────────────────────────

pub fn gc_object_size(obj: *mut SkObject) -> usize {
    if obj.is_null() {
        return 0;
    }
    unsafe {
        match &(*obj).body {
            ObjBody::Str(s) => std::mem::size_of::<SkObject>() + s.cap + 1,
            ObjBody::Array(a) => {
                std::mem::size_of::<SkObject>() + a.items.capacity() * std::mem::size_of::<Value>()
            }
            ObjBody::Dict(d) => {
                std::mem::size_of::<SkObject>() + d.num_buckets * 8 + d.count * (24 + 32)
            }
            ObjBody::Closure(_) => std::mem::size_of::<SkObject>(),
        }
    }
}

// ── creation / destruction ──────────────────────────────────────────────

pub fn gc_create() -> GcPtr {
    let gc = Box::new(Gc {
        list_head: ptr::null_mut(),
        list_tail: ptr::null_mut(),
        object_count: 0,
        bytes_allocated: 0,
        roots: ptr::null_mut(),
        root_count: 0,
        gray: GrayQueue::new(),
        threshold: 1024 * 1024,
        paused: false,
        stats: GcStats::default(),
        incremental: false,
        step_budget: 128,
        marking_in_progress: false,
        barrier_log: Vec::with_capacity(64),
        root_scanner: None,
        root_scanner_data: ptr::null_mut(),
    });
    GcPtr(Box::into_raw(gc))
}

/// Tear down the GC. Objects it still tracks are released through the heap's
/// reference-counting path, then the node list and root list are freed.
pub fn gc_destroy(gc: GcPtr) {
    if gc.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        // Free every tracked object exactly once, independently. Each object
        // is enrolled in this list, so releasing its storage directly (without
        // cascading through child reference counts) reclaims the whole graph
        // without double-freeing objects reachable through more than one path.
        let mut n = g.list_head;
        while !n.is_null() {
            let next = (*n).next;
            let obj = (*n).obj;
            if !obj.is_null() {
                (*obj).gc = GcPtr::null();
                drop(Box::from_raw(obj));
            }
            drop(Box::from_raw(n));
            n = next;
        }
        let mut r = g.roots;
        while !r.is_null() {
            let next = (*r).next;
            drop(Box::from_raw(r));
            r = next;
        }
        drop(Box::from_raw(gc.0));
    }
}

// ── tracking ────────────────────────────────────────────────────────────

pub fn gc_track(gc: GcPtr, obj: *mut SkObject) {
    if gc.is_null() || obj.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        (*obj).gc = gc;
        let n = Box::into_raw(Box::new(GcNode {
            obj,
            color: GC_COLOR_WHITE,
            obj_size: gc_object_size(obj),
            prev: g.list_tail,
            next: ptr::null_mut(),
        }));
        let sz = (*n).obj_size;
        if !g.list_tail.is_null() {
            (*g.list_tail).next = n;
        } else {
            g.list_head = n;
        }
        g.list_tail = n;
        g.object_count += 1;
        g.bytes_allocated += sz;
        g.stats.total_allocated += sz;
        g.stats.live_objects += 1;
    }
}

pub fn gc_untrack(gc: GcPtr, obj: *mut SkObject) {
    if gc.is_null() || obj.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        let mut n = g.list_head;
        while !n.is_null() {
            if (*n).obj == obj {
                (*obj).gc = GcPtr::null();
                if !(*n).prev.is_null() {
                    (*(*n).prev).next = (*n).next;
                } else {
                    g.list_head = (*n).next;
                }
                if !(*n).next.is_null() {
                    (*(*n).next).prev = (*n).prev;
                } else {
                    g.list_tail = (*n).prev;
                }
                g.object_count -= 1;
                let sz = (*n).obj_size;
                g.bytes_allocated = g.bytes_allocated.saturating_sub(sz);
                g.stats.live_objects = g.stats.live_objects.saturating_sub(1);
                drop(Box::from_raw(n));
                return;
            }
            n = (*n).next;
        }
    }
}

// ── roots ───────────────────────────────────────────────────────────────

pub fn gc_add_root(gc: GcPtr, value_ptr: *mut Value) {
    if gc.is_null() || value_ptr.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        let r = Box::into_raw(Box::new(RootEntry {
            ptr: value_ptr,
            next: g.roots,
        }));
        g.roots = r;
        g.root_count += 1;
    }
}

pub fn gc_remove_root(gc: GcPtr, value_ptr: *mut Value) {
    if gc.is_null() || value_ptr.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        let mut cur = &mut g.roots as *mut *mut RootEntry;
        while !(*cur).is_null() {
            if (**cur).ptr == value_ptr {
                let dead = *cur;
                *cur = (*dead).next;
                drop(Box::from_raw(dead));
                g.root_count -= 1;
                return;
            }
            cur = &mut (**cur).next as *mut *mut RootEntry;
        }
    }
}

pub fn gc_set_root_scanner(gc: GcPtr, scanner: Option<RootScanner>, user_data: *mut c_void) {
    if gc.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        g.root_scanner = scanner;
        g.root_scanner_data = user_data;
    }
}

// ── marking ─────────────────────────────────────────────────────────────

unsafe fn gc_find_node(g: &mut Gc, obj: *mut SkObject) -> *mut GcNode {
    let mut n = g.list_head;
    while !n.is_null() {
        if (*n).obj == obj {
            return n;
        }
        n = (*n).next;
    }
    ptr::null_mut()
}

pub fn gc_mark_value(gc: GcPtr, v: Value) {
    let obj = match v {
        Value::Obj(o) if !o.is_null() => o,
        _ => return,
    };
    unsafe {
        let g = gc.r();
        let n = gc_find_node(g, obj);
        if n.is_null() {
            return;
        }
        if (*n).color == GC_COLOR_WHITE {
            (*n).color = GC_COLOR_GRAY;
            g.gray.push(n);
        }
    }
}

unsafe fn gc_mark_roots(gc: GcPtr) {
    let g = gc.r();
    if let Some(scanner) = g.root_scanner {
        scanner(gc, g.root_scanner_data);
        return;
    }
    let mut r = g.roots;
    while !r.is_null() {
        gc_mark_value(gc, *(*r).ptr);
        r = (*r).next;
    }
}

unsafe fn gc_process_gray(gc: GcPtr, n: *mut GcNode) {
    let obj = (*n).obj;
    (*n).color = GC_COLOR_BLACK;
    match &(*obj).body {
        ObjBody::Str(_) => {}
        ObjBody::Array(a) => {
            for i in 0..a.items.len() {
                gc_mark_value(gc, a.items[i]);
            }
        }
        ObjBody::Dict(d) => {
            for bucket in &d.buckets {
                for e in bucket {
                    gc_mark_value(gc, e.value);
                }
            }
        }
        ObjBody::Closure(c) => {
            gc_mark_value(gc, c.captured);
        }
    }
}

// ── sweep ───────────────────────────────────────────────────────────────

/// Free an unreachable object directly, without decref-ing its children (each
/// child is reclaimed in its own sweep step).
unsafe fn gc_free_swept_object(obj: *mut SkObject) {
    if obj.is_null() {
        return;
    }
    drop(Box::from_raw(obj));
}

unsafe fn gc_sweep(gc: GcPtr) {
    let g = gc.r();
    let mut n = g.list_head;
    while !n.is_null() {
        let next = (*n).next;
        if (*n).color == GC_COLOR_WHITE {
            let obj = (*n).obj;
            if !(*n).prev.is_null() {
                (*(*n).prev).next = (*n).next;
            } else {
                g.list_head = (*n).next;
            }
            if !(*n).next.is_null() {
                (*(*n).next).prev = (*n).prev;
            } else {
                g.list_tail = (*n).prev;
            }
            g.object_count -= 1;
            let sz = (*n).obj_size;
            g.stats.total_freed += sz;
            g.stats.live_objects = g.stats.live_objects.saturating_sub(1);
            g.bytes_allocated = g.bytes_allocated.saturating_sub(sz);
            drop(Box::from_raw(n));
            gc_free_swept_object(obj);
        } else {
            (*n).color = GC_COLOR_WHITE;
        }
        n = next;
    }
}

// ── incremental step ────────────────────────────────────────────────────

pub fn gc_step(gc: GcPtr) -> i32 {
    if gc.is_null() {
        return 1;
    }
    unsafe {
        let g = gc.r();
        if !g.marking_in_progress {
            return 1;
        }
        let mut budget = g.step_budget;
        while budget > 0 && !g.gray.is_empty() {
            let n = g.gray.pop();
            if !n.is_null() && (*n).color == GC_COLOR_GRAY {
                gc_process_gray(gc, n);
            }
            budget -= 1;
        }
        let log: Vec<*mut GcNode> = std::mem::take(&mut g.barrier_log);
        for n in log {
            if !n.is_null() && (*n).color == GC_COLOR_BLACK {
                (*n).color = GC_COLOR_GRAY;
                g.gray.push(n);
            }
        }
        if g.gray.is_empty() {
            gc_sweep(gc);
            g.marking_in_progress = false;
            g.stats.num_collections += 1;
            g.stats.last_collection_ns = gc_now_ns();
            g.stats.threshold = g.threshold;
            return 1;
        }
        0
    }
}

// ── full collection ─────────────────────────────────────────────────────

pub fn gc_collect(gc: GcPtr) {
    if gc.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        if g.paused {
            return;
        }
        let t0 = gc_now_ns();
        let mut n = g.list_head;
        while !n.is_null() {
            (*n).color = GC_COLOR_WHITE;
            n = (*n).next;
        }
        gc_mark_roots(gc);
        while !g.gray.is_empty() {
            let n = g.gray.pop();
            if !n.is_null() && (*n).color == GC_COLOR_GRAY {
                gc_process_gray(gc, n);
            }
        }
        let log: Vec<*mut GcNode> = std::mem::take(&mut g.barrier_log);
        for n in log {
            if !n.is_null() && (*n).color == GC_COLOR_BLACK {
                (*n).color = GC_COLOR_GRAY;
                g.gray.push(n);
            }
        }
        while !g.gray.is_empty() {
            let n = g.gray.pop();
            if !n.is_null() && (*n).color == GC_COLOR_GRAY {
                gc_process_gray(gc, n);
            }
        }
        gc_sweep(gc);
        g.stats.num_collections += 1;
        g.stats.last_collection_ns = gc_now_ns() - t0;
        g.stats.threshold = g.threshold;
        g.marking_in_progress = false;
    }
}

pub fn gc_collect_if_needed(gc: GcPtr) {
    if gc.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        if g.paused {
            return;
        }
        if g.bytes_allocated > g.threshold {
            gc_collect(gc);
            if g.bytes_allocated > g.threshold / 2 {
                g.threshold *= 2;
            }
        }
    }
}

// ── write barrier ───────────────────────────────────────────────────────

pub fn gc_write_barrier(gc: GcPtr, parent: *mut SkObject, new_child: Value) {
    if gc.is_null() {
        return;
    }
    let child = match new_child {
        Value::Obj(o) if !o.is_null() => o,
        _ => return,
    };
    unsafe {
        let g = gc.r();
        if !g.marking_in_progress {
            return;
        }
        let pn = gc_find_node(g, parent);
        if pn.is_null() || (*pn).color != GC_COLOR_BLACK {
            return;
        }
        let cn = gc_find_node(g, child);
        if cn.is_null() || (*cn).color != GC_COLOR_WHITE {
            return;
        }
        g.barrier_log.push(cn);
    }
}

// ── configuration ───────────────────────────────────────────────────────

pub fn gc_set_threshold(gc: GcPtr, bytes: usize) {
    if gc.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        g.threshold = bytes;
        g.stats.threshold = bytes;
    }
}
pub fn gc_set_step_budget(gc: GcPtr, budget: i32) {
    if gc.is_null() || budget <= 0 {
        return;
    }
    unsafe {
        gc.r().step_budget = budget;
    }
}
pub fn gc_set_incremental(gc: GcPtr, enabled: bool) {
    if gc.is_null() {
        return;
    }
    unsafe {
        gc.r().incremental = enabled;
    }
}
pub fn gc_pause(gc: GcPtr) {
    if !gc.is_null() {
        unsafe {
            gc.r().paused = true;
        }
    }
}
pub fn gc_resume(gc: GcPtr) {
    if !gc.is_null() {
        unsafe {
            gc.r().paused = false;
        }
    }
}

pub fn gc_stats(gc: GcPtr) -> GcStats {
    if gc.is_null() {
        return GcStats::default();
    }
    unsafe {
        let g = gc.r();
        let mut s = g.stats;
        s.live_objects = g.object_count;
        s.threshold = g.threshold;
        s
    }
}

/// Manually mark an object and its transitive closure reachable (pinning).
pub fn gc_force_mark_object(gc: GcPtr, obj: *mut SkObject) {
    if gc.is_null() || obj.is_null() {
        return;
    }
    unsafe {
        let g = gc.r();
        let n = gc_find_node(g, obj);
        if n.is_null() || (*n).color != GC_COLOR_WHITE {
            return;
        }
        (*n).color = GC_COLOR_GRAY;
        g.gray.push(n);
        while !g.gray.is_empty() {
            let gg = g.gray.pop();
            if !gg.is_null() && (*gg).color == GC_COLOR_GRAY {
                gc_process_gray(gc, gg);
            }
        }
    }
}
