//! Array standard library — a faithful port of `lib/array_lib.c`.
//!
//! Native functions over `ObjArray` heap objects. Functions that build new
//! arrays allocate through the heap and transfer ownership to the caller.

use crate::heap::*;
use crate::value::Value;

/// Borrow the array payload behind an object value, if it is an array.
unsafe fn arr_ref<'a>(v: Value) -> Option<&'a mut ObjArray> {
    match v {
        Value::Obj(o) if !o.is_null() && (*o).obj_type == ObjType::Array => SkObject::as_array_mut(o),
        _ => None,
    }
}

fn argi(argv: &[Value], i: usize) -> i64 {
    argv.get(i).and_then(|v| v.as_int()).unwrap_or(0)
}

/// Build a fresh heap array from a list of values (each incref'd on store).
fn build_array(items: &[Value]) -> Value {
    let out = heap_new_array();
    unsafe {
        let a = SkObject::as_array_mut(out).unwrap();
        for &v in items {
            heap_value_incref(v);
            a.items.push(v);
        }
    }
    Value::Obj(out)
}

pub fn length(argv: &[Value]) -> Value {
    match argv.first().copied() {
        Some(v) => unsafe {
            match arr_ref(v) {
                Some(a) => Value::Int(a.items.len() as i64),
                None => Value::Null,
            }
        },
        None => Value::Null,
    }
}

pub fn is_empty(argv: &[Value]) -> Value {
    match argv.first().copied() {
        Some(v) => unsafe {
            match arr_ref(v) {
                Some(a) => Value::Int(a.items.is_empty() as i64),
                None => Value::Null,
            }
        },
        None => Value::Null,
    }
}

pub fn get(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let idx = argi(argv, 1);
                if idx >= 0 && (idx as usize) < a.items.len() {
                    return a.items[idx as usize];
                }
            }
        }
    }
    Value::Null
}

pub fn push(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let item = argv.get(1).copied().unwrap_or(Value::Null);
                heap_value_incref(item);
                a.items.push(item);
                return Value::Int(a.items.len() as i64);
            }
        }
    }
    Value::Null
}

pub fn pop(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                if let Some(x) = a.items.pop() {
                    return x; // ownership transfers to caller
                }
            }
        }
    }
    Value::Null
}

pub fn reverse(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let mut items = a.items.clone();
                items.reverse();
                return build_array(&items);
            }
        }
    }
    Value::Null
}

pub fn concat(argv: &[Value]) -> Value {
    let mut all: Vec<Value> = Vec::new();
    unsafe {
        for &v in argv {
            if let Some(a) = arr_ref(v) {
                all.extend_from_slice(&a.items);
            }
        }
    }
    build_array(&all)
}

pub fn slice(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let len = a.items.len() as i64;
                let mut start = argi(argv, 1);
                let mut end = if argv.len() > 2 { argi(argv, 2) } else { len };
                if start < 0 {
                    start += len;
                }
                if end < 0 {
                    end += len;
                }
                start = start.clamp(0, len);
                end = end.clamp(0, len);
                let sub: Vec<Value> = (start..end).map(|i| a.items[i as usize]).collect();
                return build_array(&sub);
            }
        }
    }
    Value::Null
}

pub fn index_of(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let target = argv.get(1).copied().unwrap_or(Value::Null);
                for (i, x) in a.items.iter().enumerate() {
                    if *x == target {
                        return Value::Int(i as i64);
                    }
                }
                return Value::Int(-1);
            }
        }
    }
    Value::Null
}

pub fn includes(argv: &[Value]) -> Value {
    match index_of(argv) {
        Value::Int(i) => Value::Int((i >= 0) as i64),
        _ => Value::Null,
    }
}

pub fn sum(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let mut acc = 0i64;
                let mut facc = 0.0f64;
                let mut is_float = false;
                for x in &a.items {
                    match x {
                        Value::Int(i) => acc += i,
                        Value::Float(f) => {
                            is_float = true;
                            facc += f;
                        }
                        _ => {}
                    }
                }
                return if is_float {
                    Value::Float(facc + acc as f64)
                } else {
                    Value::Int(acc)
                };
            }
        }
    }
    Value::Null
}

pub fn from_range(argv: &[Value]) -> Value {
    let start = argi(argv, 0);
    let end = argi(argv, 1);
    let items: Vec<Value> = (start..end).map(Value::Int).collect();
    build_array(&items)
}

pub fn min(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let mut best: Option<f64> = None;
                let mut best_v = Value::Null;
                for x in &a.items {
                    if let Some(f) = x.as_float() {
                        if best.map(|b| f < b).unwrap_or(true) {
                            best = Some(f);
                            best_v = *x;
                        }
                    }
                }
                return best_v;
            }
        }
    }
    Value::Null
}

pub fn max(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(a) = arr_ref(v) {
                let mut best: Option<f64> = None;
                let mut best_v = Value::Null;
                for x in &a.items {
                    if let Some(f) = x.as_float() {
                        if best.map(|b| f > b).unwrap_or(true) {
                            best = Some(f);
                            best_v = *x;
                        }
                    }
                }
                return best_v;
            }
        }
    }
    Value::Null
}
