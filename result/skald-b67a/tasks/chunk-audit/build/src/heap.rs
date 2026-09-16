//! Reference-counted object heap — a faithful port of the C `heap.c`.
//!
//! Objects are heap-allocated behind raw pointers. Reference counting drives
//! reclamation: when a count reaches zero the object's backing allocation is
//! released. Values copied around the interpreter share these pointers, and the
//! incref/decref routines are what keep the lifetimes balanced.

use crate::gc::{gc_untrack, GcPtr};
use crate::value::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjType {
    String,
    Array,
    Dict,
    Closure,
}

/// Per-object payload. The enum tag mirrors the C `obj_type` field and the
/// prefix-struct casts used throughout the original.
pub enum ObjBody {
    Str(ObjString),
    Array(ObjArray),
    Dict(ObjDict),
    Closure(ObjClosure),
}

/// Common object header shared by every heap object.
pub struct SkObject {
    pub obj_type: ObjType,
    pub refcount: i32,
    /// The collector that currently tracks this object (null if untracked).
    /// Recorded at track time so reclamation untracks from the owning
    /// collector rather than whichever one is globally active.
    pub gc: GcPtr,
    pub body: ObjBody,
}

pub struct ObjString {
    pub len: usize,
    pub cap: usize,
    pub data: Vec<u8>,
}

pub struct ObjArray {
    pub items: Vec<Value>,
}

pub struct DictEntry {
    pub key: Vec<u8>,
    pub value: Value,
}

pub struct ObjDict {
    pub num_buckets: usize,
    pub count: usize,
    pub buckets: Vec<Vec<DictEntry>>,
}

pub struct ObjClosure {
    pub func_idx: u16,
    pub captured: Value,
}

/// Global GC pointer, mirroring the C `g_gc`. Set once at VM startup.
static mut G_GC: GcPtr = GcPtr::null();

pub fn heap_set_gc(gc: GcPtr) {
    unsafe {
        G_GC = gc;
    }
}

// ── reference counting ──────────────────────────────────────────────────

pub fn heap_incref(obj: *mut SkObject) {
    if obj.is_null() {
        return;
    }
    unsafe {
        (*obj).refcount += 1;
    }
}

pub fn heap_decref(obj: *mut SkObject) {
    if obj.is_null() {
        return;
    }
    unsafe {
        (*obj).refcount -= 1;
        if (*obj).refcount <= 0 {
            obj_free(obj);
        }
    }
}

pub fn heap_value_incref(v: Value) {
    if let Value::Obj(o) = v {
        heap_incref(o);
    }
}

pub fn heap_value_decref(v: Value) {
    if let Value::Obj(o) = v {
        heap_decref(o);
    }
}

// ── constructors ────────────────────────────────────────────────────────

fn alloc_obj(obj_type: ObjType, body: ObjBody) -> *mut SkObject {
    Box::into_raw(Box::new(SkObject {
        obj_type,
        refcount: 1,
        gc: GcPtr::null(),
        body,
    }))
}

pub fn heap_new_string(data: &[u8]) -> *mut SkObject {
    let len = data.len();
    let cap = len + 1;
    let mut buf = Vec::with_capacity(cap);
    buf.extend_from_slice(data);
    buf.push(0);
    alloc_obj(
        ObjType::String,
        ObjBody::Str(ObjString {
            len,
            cap,
            data: buf,
        }),
    )
}

pub fn heap_new_array() -> *mut SkObject {
    alloc_obj(
        ObjType::Array,
        ObjBody::Array(ObjArray {
            items: Vec::with_capacity(4),
        }),
    )
}

pub fn heap_new_dict() -> *mut SkObject {
    let num_buckets = 8;
    alloc_obj(
        ObjType::Dict,
        ObjBody::Dict(ObjDict {
            num_buckets,
            count: 0,
            buckets: (0..num_buckets).map(|_| Vec::new()).collect(),
        }),
    )
}

pub fn heap_new_closure(func_idx: u16, captured: Value) -> *mut SkObject {
    let o = alloc_obj(
        ObjType::Closure,
        ObjBody::Closure(ObjClosure { func_idx, captured }),
    );
    heap_value_incref(captured);
    o
}

// ── destructor ──────────────────────────────────────────────────────────

fn obj_free(obj: *mut SkObject) {
    unsafe {
        // Untrack from the collector that actually owns this object, falling
        // back to the active one only if the object was never tracked.
        let gc = if !(*obj).gc.is_null() { (*obj).gc } else { G_GC };
        if !gc.is_null() {
            gc_untrack(gc, obj);
        }
        // Recover the box; dropping it releases the object's storage and, for
        // arrays/dicts/closures, drops references held by contained values.
        let boxed = Box::from_raw(obj);
        match boxed.body {
            ObjBody::Str(_) => {}
            ObjBody::Array(ref a) => {
                for v in &a.items {
                    heap_value_decref(*v);
                }
            }
            ObjBody::Dict(ref d) => {
                for bucket in &d.buckets {
                    for e in bucket {
                        heap_value_decref(e.value);
                    }
                }
            }
            ObjBody::Closure(ref c) => {
                heap_value_decref(c.captured);
            }
        }
        drop(boxed);
    }
}

// ── dict helpers ────────────────────────────────────────────────────────

fn dict_hash(key: &[u8]) -> u32 {
    let mut h: u32 = 2166136261;
    for &b in key {
        h = (h ^ b as u32).wrapping_mul(16777619);
    }
    h
}

/// # Safety
/// `d` must point to a live dict object.
pub unsafe fn dict_set(d: *mut ObjDict, key: &[u8], val: Value) -> i32 {
    let d = &mut *d;
    let idx = (dict_hash(key) as usize) % d.num_buckets;
    for e in d.buckets[idx].iter_mut() {
        if e.key == key {
            heap_value_decref(e.value);
            heap_value_incref(val);
            e.value = val;
            return 0;
        }
    }
    heap_value_incref(val);
    d.buckets[idx].push(DictEntry {
        key: key.to_vec(),
        value: val,
    });
    d.count += 1;
    0
}

/// # Safety
/// `d` must point to a live dict object.
pub unsafe fn dict_get(d: *const ObjDict, key: &[u8]) -> Option<Value> {
    let d = &*d;
    let idx = (dict_hash(key) as usize) % d.num_buckets;
    for e in &d.buckets[idx] {
        if e.key == key {
            return Some(e.value);
        }
    }
    None
}

// ── array helpers ───────────────────────────────────────────────────────

/// # Safety
/// `a` must point to a live array object.
pub unsafe fn array_push(a: *mut ObjArray, val: Value) -> i32 {
    heap_value_incref(val);
    (*a).items.push(val);
    0
}

/// # Safety
/// `a` must point to a live array object.
pub unsafe fn array_get(a: *const ObjArray, idx: i64) -> Value {
    let a = &*a;
    if idx < 0 || idx as usize >= a.items.len() {
        return Value::Null;
    }
    a.items[idx as usize]
}

// ── typed accessors on a raw object pointer ─────────────────────────────

impl SkObject {
    /// # Safety
    /// `obj` must point to a live object.
    pub unsafe fn as_string_mut<'a>(obj: *mut SkObject) -> Option<&'a mut ObjString> {
        match &mut (*obj).body {
            ObjBody::Str(s) => Some(s),
            _ => None,
        }
    }
    pub unsafe fn as_array_mut<'a>(obj: *mut SkObject) -> Option<&'a mut ObjArray> {
        match &mut (*obj).body {
            ObjBody::Array(a) => Some(a),
            _ => None,
        }
    }
    pub unsafe fn as_dict_mut<'a>(obj: *mut SkObject) -> Option<&'a mut ObjDict> {
        match &mut (*obj).body {
            ObjBody::Dict(d) => Some(d),
            _ => None,
        }
    }
    pub unsafe fn as_closure<'a>(obj: *mut SkObject) -> Option<&'a ObjClosure> {
        match &(*obj).body {
            ObjBody::Closure(c) => Some(c),
            _ => None,
        }
    }
}
