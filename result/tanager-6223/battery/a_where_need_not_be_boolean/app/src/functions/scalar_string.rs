//! Text helpers shared by scalar string functions.

use crate::error::{Error, Result};
use crate::types::Value;

pub(crate) fn text_map(args: &[Value], f: impl Fn(&str) -> String) -> Result<Value> {
    match &args[0] {
        Value::Null => Ok(Value::Null),
        Value::Text(s) => Ok(Value::text(f(s))),
        other => Err(Error::type_error(format!(
            "expected TEXT, got {}",
            other.data_type()
        ))),
    }
}

pub(crate) fn eval_repeat(args: &[Value]) -> Result<Value> {
    if args[0].is_null() || args[1].is_null() {
        return Ok(Value::Null);
    }
    let s = args[0].as_str()?;
    let n = args[1].as_i64()?;
    if n < 0 {
        return Err(Error::execution("REPEAT count must be non-negative"));
    }
    Ok(Value::text(s.repeat(n as usize)))
}

pub(crate) fn eval_substr(args: &[Value]) -> Result<Value> {
    if args.iter().any(|a| a.is_null()) {
        return Ok(Value::Null);
    }
    let s = args[0].as_str()?;
    let chars: Vec<char> = s.chars().collect();
    // SQL SUBSTR is 1-based; a start <= 0 counts from before the string.
    let start = args[1].as_i64()?;
    let start_idx = if start <= 0 {
        0usize
    } else {
        (start - 1) as usize
    };
    let end_idx = if args.len() == 3 {
        let len = args[2].as_i64()?;
        if len < 0 {
            return Err(Error::execution("SUBSTR length must be non-negative"));
        }
        // The length counts from the (possibly virtual) start position.
        let virtual_end = start - 1 + len;
        virtual_end.max(0) as usize
    } else {
        chars.len()
    };
    let end_idx = end_idx.min(chars.len());
    if start_idx >= end_idx {
        return Ok(Value::text(String::new()));
    }
    Ok(Value::text(
        chars[start_idx..end_idx].iter().collect::<String>(),
    ))
}

pub(crate) fn eval_replace(args: &[Value]) -> Result<Value> {
    if args.iter().any(|a| a.is_null()) {
        return Ok(Value::Null);
    }
    let s = args[0].as_str()?;
    let from = args[1].as_str()?;
    let to = args[2].as_str()?;
    if from.is_empty() {
        return Ok(Value::text(s.to_string()));
    }
    Ok(Value::text(s.replace(from, to)))
}

pub(crate) fn eval_concat(args: &[Value]) -> Result<Value> {
    // Standard/MySQL behavior: NULL anywhere yields NULL.
    if args.iter().any(|a| a.is_null()) {
        return Ok(Value::Null);
    }
    let mut out = String::new();
    for a in args {
        out.push_str(&a.to_string());
    }
    Ok(Value::text(out))
}

pub(crate) fn eval_pad(args: &[Value], left: bool) -> Result<Value> {
    if args[0].is_null() || args[1].is_null() || (args.len() == 3 && args[2].is_null()) {
        return Ok(Value::Null);
    }
    let s: Vec<char> = args[0].as_str()?.chars().collect();
    let target = args[1].as_i64()?;
    if target < 0 {
        return Err(Error::execution("pad length must be non-negative"));
    }
    let target = target as usize;
    if s.len() >= target {
        return Ok(Value::text(s[..target].iter().collect::<String>()));
    }
    let pad_chars: Vec<char> = if args.len() == 3 {
        args[2].as_str()?.chars().collect()
    } else {
        vec![' ']
    };
    if pad_chars.is_empty() {
        return Ok(Value::text(s.iter().collect::<String>()));
    }
    let mut fill = String::new();
    let needed = target - s.len();
    for i in 0..needed {
        fill.push(pad_chars[i % pad_chars.len()]);
    }
    let body: String = s.iter().collect();
    Ok(Value::text(if left {
        format!("{}{}", fill, body)
    } else {
        format!("{}{}", body, fill)
    }))
}

/// 1-based index of the first occurrence of `args[1]` in `args[0]`, or 0 if not
/// found (character-based, matching SQL's 1-based convention).
pub(crate) fn eval_instr(args: &[Value]) -> Result<Value> {
    if args[0].is_null() || args[1].is_null() {
        return Ok(Value::Null);
    }
    let haystack: Vec<char> = args[0].as_str()?.chars().collect();
    let needle: Vec<char> = args[1].as_str()?.chars().collect();
    if needle.is_empty() {
        return Ok(Value::Integer(1));
    }
    if needle.len() > haystack.len() {
        return Ok(Value::Integer(0));
    }
    for start in 0..=(haystack.len() - needle.len()) {
        if haystack[start..start + needle.len()] == needle[..] {
            return Ok(Value::Integer((start + 1) as i64));
        }
    }
    Ok(Value::Integer(0))
}
