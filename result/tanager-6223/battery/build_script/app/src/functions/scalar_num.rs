//! Numeric helpers and argument validators shared by scalar functions.

use crate::error::{Error, Result};
use crate::types::{DataType, Value};

pub(crate) fn require_numeric_or_null(func: &str, dt: DataType) -> Result<()> {
    if dt == DataType::Null || dt.is_numeric() {
        Ok(())
    } else {
        Err(Error::binder(format!(
            "{} expects a numeric argument, got {}",
            func, dt
        )))
    }
}

pub(crate) fn require_type_or_null(func: &str, dt: DataType, expected: DataType) -> Result<()> {
    if dt == DataType::Null || dt == expected {
        Ok(())
    } else {
        Err(Error::binder(format!(
            "{} expects {}, got {}",
            func, expected, dt
        )))
    }
}

pub(crate) fn require_type(func: &str, dt: DataType, expected: DataType) -> Result<()> {
    if dt == expected {
        Ok(())
    } else {
        Err(Error::binder(format!(
            "{} expects {}, got {}",
            func, expected, dt
        )))
    }
}

pub(crate) fn unary_numeric(
    args: &[Value],
    on_int: impl Fn(i64) -> Result<Value>,
    on_float: impl Fn(f64) -> Result<Value>,
) -> Result<Value> {
    match &args[0] {
        Value::Null => Ok(Value::Null),
        Value::Integer(i) => on_int(*i),
        Value::Float(f) => on_float(*f),
        other => Err(Error::type_error(format!(
            "expected numeric, got {}",
            other.data_type()
        ))),
    }
}

pub(crate) fn eval_round(args: &[Value]) -> Result<Value> {
    if args[0].is_null() {
        return Ok(Value::Null);
    }
    let digits = if args.len() == 2 {
        if args[1].is_null() {
            return Ok(Value::Null);
        }
        args[1].as_i64()?
    } else {
        0
    };
    match &args[0] {
        Value::Integer(i) if args.len() == 1 => Ok(Value::Integer(*i)),
        v => {
            let x = v.as_f64()?;
            let factor = 10f64.powi(digits as i32);
            let rounded = (x * factor).round() / factor;
            Ok(Value::Float(rounded))
        }
    }
}

pub(crate) fn eval_mod(args: &[Value]) -> Result<Value> {
    args[0].rem(&args[1])
}

/// Shared implementation of GREATEST/LEAST. NULL arguments are ignored; if every
/// argument is NULL the result is NULL.
pub(crate) fn eval_extreme(args: &[Value], greatest: bool) -> Result<Value> {
    let mut best: Option<&Value> = None;
    for v in args {
        if v.is_null() {
            continue;
        }
        best = match best {
            None => Some(v),
            Some(cur) => match v.compare(cur)? {
                Some(std::cmp::Ordering::Greater) if greatest => Some(v),
                Some(std::cmp::Ordering::Less) if !greatest => Some(v),
                _ => Some(cur),
            },
        };
    }
    Ok(best.cloned().unwrap_or(Value::Null))
}
