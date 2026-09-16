//! `From` conversions into [`Value`] for common Rust types.

use crate::types::Value;

impl From<i64> for Value {
    fn from(v: i64) -> Self {
        Value::Integer(v)
    }
}

impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Value::Float(v)
    }
}

impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Value::Boolean(v)
    }
}

impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Value::text(v)
    }
}

impl From<String> for Value {
    fn from(v: String) -> Self {
        Value::Text(v)
    }
}

#[cfg(test)]
mod tests {
    use crate::types::Value;

    #[test]
    fn conversions_build_expected_variants() {
        assert_eq!(Value::from(7i64), Value::Integer(7));
        assert_eq!(Value::from(2.5f64), Value::Float(2.5));
        assert_eq!(Value::from(true), Value::Boolean(true));
        assert_eq!(Value::from("hi"), Value::text("hi"));
        assert_eq!(Value::from(String::from("hi")), Value::text("hi"));
    }
}
