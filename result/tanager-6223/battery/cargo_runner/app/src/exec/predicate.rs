//! Three-valued boolean logic and the SQL `LIKE` matcher.
//!
//! These helpers back the evaluator's predicate handling. Keeping them here
//! isolates SQL's `NULL`-as-unknown truth tables from the expression-walking
//! code in [`crate::exec::eval`].

use crate::error::{Error, Result};
use crate::types::Value;

/// Interpret a value as a three-valued boolean (`NULL` -> `None`).
pub(crate) fn as_tv_bool(v: &Value) -> Result<Option<bool>> {
    match v {
        Value::Null => Ok(None),
        Value::Boolean(b) => Ok(Some(*b)),
        other => Err(Error::type_error(format!(
            "expected boolean, got {}",
            other.data_type()
        ))),
    }
}

/// Turn a three-valued boolean back into a [`Value`].
pub(crate) fn three_valued(b: Option<bool>) -> Value {
    match b {
        Some(v) => Value::Boolean(v),
        None => Value::Null,
    }
}

/// Three-valued `AND`: `FALSE` dominates, then `NULL`.
pub(crate) fn and_tv(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    match (a, b) {
        (Some(false), _) | (_, Some(false)) => Some(false),
        (Some(true), Some(true)) => Some(true),
        _ => None,
    }
}

/// Three-valued `OR`: `TRUE` dominates, then `NULL`.
pub(crate) fn or_tv(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    match (a, b) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (Some(false), Some(false)) => Some(false),
        _ => None,
    }
}

/// Three-valued `NOT`.
pub(crate) fn not_tv(a: Option<bool>) -> Option<bool> {
    a.map(|v| !v)
}

/// SQL `LIKE` matcher: `%` matches any run (including empty), `_` matches
/// exactly one character. Matching is over Unicode scalar values.
pub(crate) fn like_match(text: &str, pattern: &str) -> bool {
    let t: Vec<char> = text.chars().collect();
    let p: Vec<char> = pattern.chars().collect();
    like_rec(&t, &p)
}

fn like_rec(t: &[char], p: &[char]) -> bool {
    if p.is_empty() {
        return t.is_empty();
    }
    match p[0] {
        '%' => {
            // Collapse consecutive '%'.
            like_rec(t, &p[1..]) || (!t.is_empty() && like_rec(&t[1..], p))
        }
        '_' => !t.is_empty() && like_rec(&t[1..], &p[1..]),
        c => !t.is_empty() && t[0] == c && like_rec(&t[1..], &p[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_patterns() {
        assert!(like_match("hello", "h%o"));
        assert!(like_match("hello", "h_llo"));
        assert!(!like_match("hello", "h_lo"));
        assert!(like_match("abc", "%"));
        assert!(like_match("", "%"));
    }

    #[test]
    fn three_valued_tables() {
        assert_eq!(and_tv(Some(false), None), Some(false));
        assert_eq!(and_tv(Some(true), None), None);
        assert_eq!(or_tv(Some(true), None), Some(true));
        assert_eq!(or_tv(Some(false), None), None);
        assert_eq!(not_tv(None), None);
    }
}
