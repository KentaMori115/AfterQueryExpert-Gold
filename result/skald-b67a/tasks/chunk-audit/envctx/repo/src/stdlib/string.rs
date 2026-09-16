//! String standard library — a faithful port of `lib/string_lib.c`.
//!
//! Native functions over `ObjString` heap objects. String-producing functions
//! allocate new heap strings.

use crate::heap::*;
use crate::value::Value;

unsafe fn str_bytes(v: Value) -> Option<Vec<u8>> {
    match v {
        Value::Obj(o) if !o.is_null() && (*o).obj_type == ObjType::String => {
            let s = SkObject::as_string_mut(o)?;
            Some(s.data[..s.len].to_vec())
        }
        _ => None,
    }
}

fn argi(argv: &[Value], i: usize) -> i64 {
    argv.get(i).and_then(|v| v.as_int()).unwrap_or(0)
}

fn new_str(b: &[u8]) -> Value {
    Value::Obj(heap_new_string(b))
}

pub fn byte_length(argv: &[Value]) -> Value {
    match argv.first().copied() {
        Some(v) => unsafe {
            match str_bytes(v) {
                Some(b) => Value::Int(b.len() as i64),
                None => Value::Null,
            }
        },
        None => Value::Null,
    }
}

pub fn length(argv: &[Value]) -> Value {
    match argv.first().copied() {
        Some(v) => unsafe {
            match str_bytes(v) {
                Some(b) => Value::Int(crate::util::utf8::char_count(&b) as i64),
                None => Value::Null,
            }
        },
        None => Value::Null,
    }
}

pub fn upper(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(mut b) = str_bytes(v) {
                b.make_ascii_uppercase();
                return new_str(&b);
            }
        }
    }
    Value::Null
}

pub fn lower(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(mut b) = str_bytes(v) {
                b.make_ascii_lowercase();
                return new_str(&b);
            }
        }
    }
    Value::Null
}

pub fn trim(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                let s = b.iter().position(|c| !c.is_ascii_whitespace()).unwrap_or(b.len());
                let e = b
                    .iter()
                    .rposition(|c| !c.is_ascii_whitespace())
                    .map(|x| x + 1)
                    .unwrap_or(s);
                return new_str(&b[s..e]);
            }
        }
    }
    Value::Null
}

pub fn reverse(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(mut b) = str_bytes(v) {
                b.reverse();
                return new_str(&b);
            }
        }
    }
    Value::Null
}

pub fn concat(argv: &[Value]) -> Value {
    unsafe {
        let mut out = Vec::new();
        for v in argv {
            if let Some(b) = str_bytes(*v) {
                out.extend_from_slice(&b);
            }
        }
        new_str(&out)
    }
}

pub fn repeat(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                let n = argi(argv, 1).max(0) as usize;
                let mut out = Vec::with_capacity(b.len().saturating_mul(n));
                for _ in 0..n {
                    out.extend_from_slice(&b);
                }
                return new_str(&out);
            }
        }
    }
    Value::Null
}

pub fn contains(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(hay), Some(needle)) = (str_bytes(a), str_bytes(b)) {
                let found = needle.is_empty()
                    || (needle.len() <= hay.len()
                        && hay.windows(needle.len()).any(|w| w == needle.as_slice()));
                return Value::Int(found as i64);
            }
        }
    }
    Value::Null
}

pub fn starts_with(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(hay), Some(pre)) = (str_bytes(a), str_bytes(b)) {
                return Value::Int(hay.starts_with(&pre[..]) as i64);
            }
        }
    }
    Value::Null
}

pub fn ends_with(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(hay), Some(suf)) = (str_bytes(a), str_bytes(b)) {
                return Value::Int(hay.ends_with(&suf[..]) as i64);
            }
        }
    }
    Value::Null
}

pub fn index_of(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(hay), Some(needle)) = (str_bytes(a), str_bytes(b)) {
                if needle.is_empty() {
                    return Value::Int(0);
                }
                if needle.len() <= hay.len() {
                    for i in 0..=hay.len() - needle.len() {
                        if hay[i..i + needle.len()] == needle[..] {
                            return Value::Int(i as i64);
                        }
                    }
                }
                return Value::Int(-1);
            }
        }
    }
    Value::Null
}

pub fn to_int(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                if let Ok(s) = std::str::from_utf8(&b) {
                    if let Ok(i) = s.trim().parse::<i64>() {
                        return Value::Int(i);
                    }
                }
                return Value::Null;
            }
        }
    }
    Value::Null
}

pub fn to_float(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                if let Ok(s) = std::str::from_utf8(&b) {
                    if let Ok(f) = s.trim().parse::<f64>() {
                        return Value::Float(f);
                    }
                }
                return Value::Null;
            }
        }
    }
    Value::Null
}

pub fn from_int(argv: &[Value]) -> Value {
    new_str(argi(argv, 0).to_string().as_bytes())
}

pub fn encode_hex(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                let mut out = String::with_capacity(b.len() * 2);
                for byte in b {
                    out.push_str(&format!("{:02x}", byte));
                }
                return new_str(out.as_bytes());
            }
        }
    }
    Value::Null
}

pub fn is_digit(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                let r = !b.is_empty() && b.iter().all(|c| c.is_ascii_digit());
                return Value::Int(r as i64);
            }
        }
    }
    Value::Null
}

pub fn is_alpha(argv: &[Value]) -> Value {
    if let Some(v) = argv.first().copied() {
        unsafe {
            if let Some(b) = str_bytes(v) {
                let r = !b.is_empty() && b.iter().all(|c| c.is_ascii_alphabetic());
                return Value::Int(r as i64);
            }
        }
    }
    Value::Null
}

pub fn compare(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(x), Some(y)) = (str_bytes(a), str_bytes(b)) {
                return Value::Int(match x.cmp(&y) {
                    std::cmp::Ordering::Less => -1,
                    std::cmp::Ordering::Equal => 0,
                    std::cmp::Ordering::Greater => 1,
                });
            }
        }
    }
    Value::Null
}

/// Split a string on a byte delimiter, returning an array of substrings.
pub fn split(argv: &[Value]) -> Value {
    if let (Some(a), Some(b)) = (argv.first().copied(), argv.get(1).copied()) {
        unsafe {
            if let (Some(hay), Some(sep)) = (str_bytes(a), str_bytes(b)) {
                let out = heap_new_array();
                let oa = SkObject::as_array_mut(out).unwrap() as *mut ObjArray;
                if sep.is_empty() {
                    array_push(oa, new_str(&hay));
                } else {
                    let mut start = 0;
                    let mut i = 0;
                    while i + sep.len() <= hay.len() {
                        if hay[i..i + sep.len()] == sep[..] {
                            array_push(oa, new_str(&hay[start..i]));
                            i += sep.len();
                            start = i;
                        } else {
                            i += 1;
                        }
                    }
                    array_push(oa, new_str(&hay[start..]));
                }
                return Value::Obj(out);
            }
        }
    }
    Value::Null
}
