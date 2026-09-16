//! Human-readable rendering of runtime values.
//!
//! Produces a debug-style representation of a [`Value`], following object
//! references into strings, arrays, and dicts. Depth-limited to avoid runaway
//! output on deeply nested structures.

use crate::heap::*;
use crate::value::Value;

const MAX_DEPTH: i32 = 64;

/// Render `v` to a byte string (UTF-8 where possible).
pub fn render(v: Value) -> Vec<u8> {
    let mut out = Vec::new();
    render_into(&mut out, v, MAX_DEPTH);
    out
}

fn render_into(out: &mut Vec<u8>, v: Value, depth: i32) {
    if depth <= 0 {
        out.extend_from_slice(b"...");
        return;
    }
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Int(i) => out.extend_from_slice(i.to_string().as_bytes()),
        Value::Float(f) => out.extend_from_slice(format!("{f}").as_bytes()),
        Value::Obj(o) => {
            if o.is_null() {
                out.extend_from_slice(b"<nil>");
                return;
            }
            unsafe {
                match (*o).obj_type {
                    ObjType::String => {
                        let bytes = {
                            let s = SkObject::as_string_mut(o).unwrap();
                            s.data[..s.len].to_vec()
                        };
                        render_string(out, &bytes);
                    }
                    ObjType::Array => {
                        let items = {
                            let a = SkObject::as_array_mut(o).unwrap();
                            a.items.clone()
                        };
                        out.push(b'[');
                        for (i, it) in items.iter().enumerate() {
                            if i > 0 {
                                out.extend_from_slice(b", ");
                            }
                            render_into(out, *it, depth - 1);
                        }
                        out.push(b']');
                    }
                    ObjType::Dict => {
                        let entries: Vec<(Vec<u8>, Value)> = {
                            let d = SkObject::as_dict_mut(o).unwrap();
                            let mut v = Vec::new();
                            for bucket in &d.buckets {
                                for e in bucket {
                                    v.push((e.key.clone(), e.value));
                                }
                            }
                            v
                        };
                        out.push(b'{');
                        for (i, (k, val)) in entries.iter().enumerate() {
                            if i > 0 {
                                out.extend_from_slice(b", ");
                            }
                            render_string(out, k);
                            out.extend_from_slice(b": ");
                            render_into(out, *val, depth - 1);
                        }
                        out.push(b'}');
                    }
                    ObjType::Closure => {
                        let c = SkObject::as_closure(o).unwrap();
                        out.extend_from_slice(format!("<closure #{}>", c.func_idx).as_bytes());
                    }
                }
            }
        }
    }
}

fn render_string(out: &mut Vec<u8>, s: &[u8]) {
    out.push(b'"');
    for &c in s {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x20..=0x7e => out.push(c),
            _ => out.extend_from_slice(format!("\\x{c:02x}").as_bytes()),
        }
    }
    out.push(b'"');
}

/// Name of a value's runtime type.
pub fn type_name(v: Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Int(_) => "int",
        Value::Float(_) => "float",
        Value::Obj(o) => {
            if o.is_null() {
                return "nil";
            }
            unsafe {
                match (*o).obj_type {
                    ObjType::String => "string",
                    ObjType::Array => "array",
                    ObjType::Dict => "dict",
                    ObjType::Closure => "closure",
                }
            }
        }
    }
}
