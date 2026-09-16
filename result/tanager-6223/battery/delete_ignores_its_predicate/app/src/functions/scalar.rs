//! The scalar function registry: name resolution, type checking, evaluation.

use crate::error::{Error, Result};
use crate::functions::scalar_num::{
    eval_extreme, eval_mod, eval_round, require_numeric_or_null, require_type,
    require_type_or_null, unary_numeric,
};
use crate::functions::scalar_string::{
    eval_concat, eval_instr, eval_pad, eval_repeat, eval_replace, eval_substr, text_map,
};
use crate::types::{DataType, Value};

/// A built-in scalar function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScalarFn {
    Abs,
    Round,
    Ceil,
    Floor,
    Mod,
    Power,
    Sqrt,
    Sign,
    Length,
    Upper,
    Lower,
    Trim,
    LTrim,
    RTrim,
    Reverse,
    Repeat,
    Substr,
    Concat,
    Coalesce,
    NullIf,
    Replace,
    Greatest,
    Least,
    LPad,
    RPad,
    Instr,
}

impl ScalarFn {
    /// Resolve a (case-insensitive) function name.
    pub fn from_name(name: &str) -> Option<ScalarFn> {
        let f = match name.to_ascii_uppercase().as_str() {
            "ABS" => ScalarFn::Abs,
            "ROUND" => ScalarFn::Round,
            "CEIL" | "CEILING" => ScalarFn::Ceil,
            "FLOOR" => ScalarFn::Floor,
            "MOD" => ScalarFn::Mod,
            "POWER" | "POW" => ScalarFn::Power,
            "SQRT" => ScalarFn::Sqrt,
            "SIGN" => ScalarFn::Sign,
            "LENGTH" | "CHAR_LENGTH" => ScalarFn::Length,
            "UPPER" => ScalarFn::Upper,
            "LOWER" => ScalarFn::Lower,
            "TRIM" => ScalarFn::Trim,
            "LTRIM" => ScalarFn::LTrim,
            "RTRIM" => ScalarFn::RTrim,
            "REVERSE" => ScalarFn::Reverse,
            "REPEAT" => ScalarFn::Repeat,
            "SUBSTR" | "SUBSTRING" => ScalarFn::Substr,
            "CONCAT" => ScalarFn::Concat,
            "COALESCE" | "IFNULL" => ScalarFn::Coalesce,
            "NULLIF" => ScalarFn::NullIf,
            "REPLACE" => ScalarFn::Replace,
            "GREATEST" => ScalarFn::Greatest,
            "LEAST" => ScalarFn::Least,
            "LPAD" => ScalarFn::LPad,
            "RPAD" => ScalarFn::RPad,
            "INSTR" | "STRPOS" => ScalarFn::Instr,
            _ => return None,
        };
        Some(f)
    }

    /// The canonical upper-case name for diagnostics.
    pub fn name(self) -> &'static str {
        match self {
            ScalarFn::Abs => "ABS",
            ScalarFn::Round => "ROUND",
            ScalarFn::Ceil => "CEIL",
            ScalarFn::Floor => "FLOOR",
            ScalarFn::Mod => "MOD",
            ScalarFn::Power => "POWER",
            ScalarFn::Sqrt => "SQRT",
            ScalarFn::Sign => "SIGN",
            ScalarFn::Length => "LENGTH",
            ScalarFn::Upper => "UPPER",
            ScalarFn::Lower => "LOWER",
            ScalarFn::Trim => "TRIM",
            ScalarFn::LTrim => "LTRIM",
            ScalarFn::RTrim => "RTRIM",
            ScalarFn::Reverse => "REVERSE",
            ScalarFn::Repeat => "REPEAT",
            ScalarFn::Substr => "SUBSTR",
            ScalarFn::Concat => "CONCAT",
            ScalarFn::Coalesce => "COALESCE",
            ScalarFn::NullIf => "NULLIF",
            ScalarFn::Replace => "REPLACE",
            ScalarFn::Greatest => "GREATEST",
            ScalarFn::Least => "LEAST",
            ScalarFn::LPad => "LPAD",
            ScalarFn::RPad => "RPAD",
            ScalarFn::Instr => "INSTR",
        }
    }

    /// Type-check the argument types and return the function's result type.
    ///
    /// This is where arity and argument-type rules live; the binder calls it so
    /// type errors surface before execution.
    pub fn return_type(self, args: &[DataType]) -> Result<DataType> {
        let arity_err = |expected: &str| {
            Error::binder(format!(
                "{} expects {} argument(s), got {}",
                self.name(),
                expected,
                args.len()
            ))
        };
        match self {
            ScalarFn::Abs | ScalarFn::Ceil | ScalarFn::Floor => {
                if args.len() != 1 {
                    return Err(arity_err("1"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                Ok(args[0])
            }
            ScalarFn::Round => {
                if args.is_empty() || args.len() > 2 {
                    return Err(arity_err("1 or 2"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                if args.len() == 2 {
                    require_type(self.name(), args[1], DataType::Integer)?;
                    Ok(DataType::Float)
                } else {
                    Ok(args[0])
                }
            }
            ScalarFn::Mod => {
                if args.len() != 2 {
                    return Err(arity_err("2"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                require_numeric_or_null(self.name(), args[1])?;
                Ok(DataType::Integer
                    .arithmetic_result(DataType::Integer)
                    .filter(|_| args[0] != DataType::Float && args[1] != DataType::Float)
                    .unwrap_or(DataType::Float))
            }
            ScalarFn::Power => {
                if args.len() != 2 {
                    return Err(arity_err("2"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                require_numeric_or_null(self.name(), args[1])?;
                Ok(DataType::Float)
            }
            ScalarFn::Sqrt => {
                if args.len() != 1 {
                    return Err(arity_err("1"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                Ok(DataType::Float)
            }
            ScalarFn::Sign => {
                if args.len() != 1 {
                    return Err(arity_err("1"));
                }
                require_numeric_or_null(self.name(), args[0])?;
                Ok(args[0])
            }
            ScalarFn::Length => {
                if args.len() != 1 {
                    return Err(arity_err("1"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                Ok(DataType::Integer)
            }
            ScalarFn::Upper
            | ScalarFn::Lower
            | ScalarFn::Trim
            | ScalarFn::LTrim
            | ScalarFn::RTrim
            | ScalarFn::Reverse => {
                if args.len() != 1 {
                    return Err(arity_err("1"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                Ok(DataType::Text)
            }
            ScalarFn::Repeat => {
                if args.len() != 2 {
                    return Err(arity_err("2"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                require_type_or_null(self.name(), args[1], DataType::Integer)?;
                Ok(DataType::Text)
            }
            ScalarFn::Substr => {
                if args.len() < 2 || args.len() > 3 {
                    return Err(arity_err("2 or 3"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                require_type_or_null(self.name(), args[1], DataType::Integer)?;
                if args.len() == 3 {
                    require_type_or_null(self.name(), args[2], DataType::Integer)?;
                }
                Ok(DataType::Text)
            }
            ScalarFn::Replace => {
                if args.len() != 3 {
                    return Err(arity_err("3"));
                }
                for a in args {
                    require_type_or_null(self.name(), *a, DataType::Text)?;
                }
                Ok(DataType::Text)
            }
            ScalarFn::Concat => {
                if args.is_empty() {
                    return Err(arity_err("at least 1"));
                }
                Ok(DataType::Text)
            }
            ScalarFn::Coalesce => {
                if args.is_empty() {
                    return Err(arity_err("at least 1"));
                }
                // Result type is the unification of all argument types.
                let mut acc = DataType::Null;
                for &a in args {
                    acc = acc.unify(a).ok_or_else(|| {
                        Error::binder(format!(
                            "COALESCE arguments have incompatible types {} and {}",
                            acc, a
                        ))
                    })?;
                }
                Ok(acc)
            }
            ScalarFn::NullIf => {
                if args.len() != 2 {
                    return Err(arity_err("2"));
                }
                Ok(args[0])
            }
            ScalarFn::LPad | ScalarFn::RPad => {
                if args.len() < 2 || args.len() > 3 {
                    return Err(arity_err("2 or 3"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                require_type_or_null(self.name(), args[1], DataType::Integer)?;
                if args.len() == 3 {
                    require_type_or_null(self.name(), args[2], DataType::Text)?;
                }
                Ok(DataType::Text)
            }
            ScalarFn::Instr => {
                if args.len() != 2 {
                    return Err(arity_err("2"));
                }
                require_type_or_null(self.name(), args[0], DataType::Text)?;
                require_type_or_null(self.name(), args[1], DataType::Text)?;
                Ok(DataType::Integer)
            }
            ScalarFn::Greatest | ScalarFn::Least => {
                if args.is_empty() {
                    return Err(arity_err("at least 1"));
                }
                let mut acc = DataType::Null;
                for &a in args {
                    acc = acc.unify(a).ok_or_else(|| {
                        Error::binder(format!(
                            "{} arguments have incompatible types {} and {}",
                            self.name(),
                            acc,
                            a
                        ))
                    })?;
                }
                Ok(acc)
            }
        }
    }

    /// Evaluate the function on already-computed argument values.
    pub fn eval(self, args: &[Value]) -> Result<Value> {
        match self {
            ScalarFn::Abs => unary_numeric(
                args,
                |i| Ok(Value::Integer(i.wrapping_abs())),
                |f| Ok(Value::Float(f.abs())),
            ),
            ScalarFn::Ceil => unary_numeric(
                args,
                |i| Ok(Value::Integer(i)),
                |f| Ok(Value::Float(f.ceil())),
            ),
            ScalarFn::Floor => unary_numeric(
                args,
                |i| Ok(Value::Integer(i)),
                |f| Ok(Value::Float(f.floor())),
            ),
            ScalarFn::Round => eval_round(args),
            ScalarFn::Mod => eval_mod(args),
            ScalarFn::Power => {
                if args[0].is_null() || args[1].is_null() {
                    Ok(Value::Null)
                } else {
                    Ok(Value::Float(args[0].as_f64()?.powf(args[1].as_f64()?)))
                }
            }
            ScalarFn::Sqrt => match &args[0] {
                Value::Null => Ok(Value::Null),
                v => {
                    let x = v.as_f64()?;
                    if x < 0.0 {
                        Err(Error::execution("SQRT of a negative number"))
                    } else {
                        Ok(Value::Float(x.sqrt()))
                    }
                }
            },
            ScalarFn::Sign => unary_numeric(
                args,
                |i| Ok(Value::Integer(i.signum())),
                |f| {
                    Ok(Value::Float(if f > 0.0 {
                        1.0
                    } else if f < 0.0 {
                        -1.0
                    } else {
                        0.0
                    }))
                },
            ),
            ScalarFn::Length => match &args[0] {
                Value::Null => Ok(Value::Null),
                Value::Text(s) => Ok(Value::Integer(s.chars().count() as i64)),
                other => Err(Error::type_error(format!(
                    "LENGTH expects TEXT, got {}",
                    other.data_type()
                ))),
            },
            ScalarFn::Upper => text_map(args, |s| s.to_uppercase()),
            ScalarFn::Lower => text_map(args, |s| s.to_lowercase()),
            ScalarFn::Trim => text_map(args, |s| s.trim().to_string()),
            ScalarFn::LTrim => text_map(args, |s| s.trim_start().to_string()),
            ScalarFn::RTrim => text_map(args, |s| s.trim_end().to_string()),
            ScalarFn::Reverse => text_map(args, |s| s.chars().rev().collect()),
            ScalarFn::Repeat => eval_repeat(args),
            ScalarFn::Substr => eval_substr(args),
            ScalarFn::Replace => eval_replace(args),
            ScalarFn::Concat => eval_concat(args),
            ScalarFn::Coalesce => Ok(args
                .iter()
                .find(|v| !v.is_null())
                .cloned()
                .unwrap_or(Value::Null)),
            ScalarFn::NullIf => match args[0].logical_eq(&args[1])? {
                Some(true) => Ok(Value::Null),
                _ => Ok(args[0].clone()),
            },
            ScalarFn::Greatest => eval_extreme(args, true),
            ScalarFn::Least => eval_extreme(args, false),
            ScalarFn::LPad => eval_pad(args, true),
            ScalarFn::RPad => eval_pad(args, false),
            ScalarFn::Instr => eval_instr(args),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_aliases() {
        assert_eq!(ScalarFn::from_name("ceiling"), Some(ScalarFn::Ceil));
        assert_eq!(ScalarFn::from_name("ifnull"), Some(ScalarFn::Coalesce));
        assert_eq!(ScalarFn::from_name("nope"), None);
    }

    #[test]
    fn length_counts_chars() {
        assert_eq!(
            ScalarFn::Length.eval(&[Value::text("héllo")]).unwrap(),
            Value::Integer(5)
        );
    }

    #[test]
    fn substr_is_one_based() {
        assert_eq!(
            ScalarFn::Substr
                .eval(&[Value::text("abcdef"), Value::Integer(2), Value::Integer(3)])
                .unwrap(),
            Value::text("bcd")
        );
    }

    #[test]
    fn coalesce_returns_first_non_null() {
        assert_eq!(
            ScalarFn::Coalesce
                .eval(&[Value::Null, Value::Null, Value::Integer(7)])
                .unwrap(),
            Value::Integer(7)
        );
    }

    #[test]
    fn concat_propagates_null() {
        assert!(ScalarFn::Concat
            .eval(&[Value::text("a"), Value::Null])
            .unwrap()
            .is_null());
    }

    #[test]
    fn nullif_matches() {
        assert!(ScalarFn::NullIf
            .eval(&[Value::Integer(3), Value::Integer(3)])
            .unwrap()
            .is_null());
        assert_eq!(
            ScalarFn::NullIf
                .eval(&[Value::Integer(3), Value::Integer(4)])
                .unwrap(),
            Value::Integer(3)
        );
    }

    #[test]
    fn round_with_digits() {
        assert_eq!(
            ScalarFn::Round
                .eval(&[Value::Float(9.8765), Value::Integer(2)])
                .unwrap(),
            Value::Float(9.88)
        );
    }

    #[test]
    fn string_shaping_functions() {
        assert_eq!(
            ScalarFn::LTrim.eval(&[Value::text("  hi ")]).unwrap(),
            Value::text("hi ")
        );
        assert_eq!(
            ScalarFn::RTrim.eval(&[Value::text(" hi  ")]).unwrap(),
            Value::text(" hi")
        );
        assert_eq!(
            ScalarFn::Reverse.eval(&[Value::text("abc")]).unwrap(),
            Value::text("cba")
        );
        assert_eq!(
            ScalarFn::Repeat
                .eval(&[Value::text("ab"), Value::Integer(3)])
                .unwrap(),
            Value::text("ababab")
        );
        assert!(ScalarFn::Repeat
            .eval(&[Value::text("x"), Value::Integer(-1)])
            .is_err());
    }

    #[test]
    fn math_functions() {
        assert_eq!(
            ScalarFn::Power
                .eval(&[Value::Integer(2), Value::Integer(10)])
                .unwrap(),
            Value::Float(1024.0)
        );
        assert_eq!(
            ScalarFn::Sqrt.eval(&[Value::Float(9.0)]).unwrap(),
            Value::Float(3.0)
        );
        assert_eq!(
            ScalarFn::Sign.eval(&[Value::Integer(-5)]).unwrap(),
            Value::Integer(-1)
        );
        assert!(ScalarFn::Sqrt.eval(&[Value::Float(-1.0)]).is_err());
    }

    #[test]
    fn greatest_and_least_ignore_nulls() {
        assert_eq!(
            ScalarFn::Greatest
                .eval(&[
                    Value::Integer(3),
                    Value::Null,
                    Value::Integer(9),
                    Value::Integer(1)
                ])
                .unwrap(),
            Value::Integer(9)
        );
        assert_eq!(
            ScalarFn::Least
                .eval(&[Value::Integer(3), Value::Null, Value::Integer(1)])
                .unwrap(),
            Value::Integer(1)
        );
        assert!(ScalarFn::Least.eval(&[Value::Null]).unwrap().is_null());
    }

    #[test]
    fn type_checks_arity() {
        assert!(ScalarFn::Abs
            .return_type(&[DataType::Integer, DataType::Integer])
            .is_err());
        assert_eq!(
            ScalarFn::Upper.return_type(&[DataType::Text]).unwrap(),
            DataType::Text
        );
        assert!(ScalarFn::Upper.return_type(&[DataType::Integer]).is_err());
    }
}
