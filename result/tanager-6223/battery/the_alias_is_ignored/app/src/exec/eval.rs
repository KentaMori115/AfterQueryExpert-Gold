//! The expression evaluator: a [`BoundExpr`] applied to a [`Row`] yields a
//! [`Value`], honoring SQL three-valued logic throughout.

use std::cmp::Ordering;

use crate::ast::operators::{BinaryOp, UnaryOp};
use crate::error::{Error, Result};
use crate::exec::predicate::{and_tv, as_tv_bool, like_match, not_tv, or_tv, three_valued};
use crate::planner::bound::BoundExpr;
use crate::storage::Row;
use crate::types::{DataType, Value};

/// Evaluate `expr` against `row`.
pub fn eval(expr: &BoundExpr, row: &Row) -> Result<Value> {
    match expr {
        BoundExpr::Literal(v) => Ok(v.clone()),

        BoundExpr::Column { index, .. } => row
            .get(*index)
            .cloned()
            .ok_or_else(|| Error::execution(format!("column index {} out of range", index))),

        BoundExpr::Binary {
            op, left, right, ..
        } => eval_binary(*op, left, right, row),

        BoundExpr::Unary { op, expr, .. } => {
            let v = eval(expr, row)?;
            match op {
                UnaryOp::Negate => v.neg(),
                UnaryOp::Not => Ok(three_valued(not_tv(as_tv_bool(&v)?))),
            }
        }

        BoundExpr::Cast { expr, data_type } => {
            let v = eval(expr, row)?;
            v.cast(*data_type)
        }

        BoundExpr::IsNull { expr, negated } => {
            let v = eval(expr, row)?;
            let is_null = v.is_null();
            Ok(Value::Boolean(if *negated { !is_null } else { is_null }))
        }

        BoundExpr::Between {
            expr,
            low,
            high,
            negated,
        } => {
            let v = eval(expr, row)?;
            if v.is_null() {
                return Ok(Value::Null);
            }
            let lo = eval(low, row)?;
            let hi = eval(high, row)?;
            let ge = v.compare(&lo)?.map(|o| o != Ordering::Less);
            let le = v.compare(&hi)?.map(|o| o != Ordering::Greater);
            let within = and_tv(ge, le);
            Ok(three_valued(if *negated { not_tv(within) } else { within }))
        }

        BoundExpr::InList {
            expr,
            list,
            negated,
        } => {
            let v = eval(expr, row)?;
            if v.is_null() {
                return Ok(Value::Null);
            }
            let mut saw_null = false;
            let mut found = false;
            for item in list {
                let iv = eval(item, row)?;
                match v.logical_eq(&iv)? {
                    Some(true) => {
                        found = true;
                        break;
                    }
                    Some(false) => {}
                    None => saw_null = true,
                }
            }
            let result = if found {
                Some(true)
            } else if saw_null {
                None
            } else {
                Some(false)
            };
            Ok(three_valued(if *negated { not_tv(result) } else { result }))
        }

        BoundExpr::Like {
            expr,
            pattern,
            negated,
        } => {
            let v = eval(expr, row)?;
            let p = eval(pattern, row)?;
            if v.is_null() || p.is_null() {
                return Ok(Value::Null);
            }
            let matched = like_match(v.as_str()?, p.as_str()?);
            Ok(Value::Boolean(if *negated { !matched } else { matched }))
        }

        BoundExpr::Case {
            operand,
            when_then,
            else_result,
            data_type,
        } => eval_case(operand, when_then, else_result, *data_type, row),

        BoundExpr::Scalar { func, args, .. } => {
            let mut values = Vec::with_capacity(args.len());
            for a in args {
                values.push(eval(a, row)?);
            }
            func.eval(&values)
        }
    }
}

fn eval_binary(op: BinaryOp, left: &BoundExpr, right: &BoundExpr, row: &Row) -> Result<Value> {
    // AND / OR use short-circuit-free three-valued logic (both sides evaluated).
    if op.is_logical() {
        let l = as_tv_bool(&eval(left, row)?)?;
        let r = as_tv_bool(&eval(right, row)?)?;
        let result = match op {
            BinaryOp::And => and_tv(l, r),
            BinaryOp::Or => or_tv(l, r),
            _ => unreachable!(),
        };
        return Ok(three_valued(result));
    }

    let l = eval(left, row)?;
    let r = eval(right, row)?;
    if op.is_concat() {
        if l.is_null() || r.is_null() {
            return Ok(Value::Null);
        }
        return Ok(Value::text(format!("{}{}", l.as_str()?, r.as_str()?)));
    }
    if op.is_arithmetic() {
        match op {
            BinaryOp::Add => l.add(&r),
            BinaryOp::Subtract => l.sub(&r),
            BinaryOp::Multiply => l.mul(&r),
            BinaryOp::Divide => l.div(&r),
            BinaryOp::Modulo => l.rem(&r),
            _ => unreachable!(),
        }
    } else {
        // Comparison: three-valued.
        let ordering = l.compare(&r)?;
        let result = ordering.map(|o| match op {
            BinaryOp::Eq => o == Ordering::Equal,
            BinaryOp::NotEq => o != Ordering::Equal,
            BinaryOp::Lt => o == Ordering::Less,
            BinaryOp::LtEq => o != Ordering::Greater,
            BinaryOp::Gt => o == Ordering::Greater,
            BinaryOp::GtEq => o != Ordering::Less,
            _ => unreachable!(),
        });
        Ok(three_valued(result))
    }
}

fn eval_case(
    operand: &Option<Box<BoundExpr>>,
    when_then: &[(BoundExpr, BoundExpr)],
    else_result: &Option<Box<BoundExpr>>,
    data_type: DataType,
    row: &Row,
) -> Result<Value> {
    let operand_val = match operand {
        Some(o) => Some(eval(o, row)?),
        None => None,
    };
    for (cond, result) in when_then {
        let cond_val = eval(cond, row)?;
        let hit = match &operand_val {
            // Simple CASE: operand = when-value (NULL never matches).
            Some(op) => matches!(op.logical_eq(&cond_val)?, Some(true)),
            // Searched CASE: when-condition must be exactly TRUE.
            None => cond_val.is_truthy(),
        };
        if hit {
            return coerce_case(eval(result, row)?, data_type);
        }
    }
    match else_result {
        Some(e) => coerce_case(eval(e, row)?, data_type),
        None => Ok(Value::Null),
    }
}

/// Coerce a CASE branch result to the case's unified type so the output column
/// has a single consistent type (e.g. an INTEGER branch widened to FLOAT).
fn coerce_case(value: Value, data_type: DataType) -> Result<Value> {
    if value.is_null() || data_type == DataType::Null || value.data_type() == data_type {
        Ok(value)
    } else {
        value.cast(data_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::DataType;

    fn col(i: usize, dt: DataType) -> BoundExpr {
        BoundExpr::Column {
            index: i,
            data_type: dt,
        }
    }
    fn lit(v: Value) -> BoundExpr {
        BoundExpr::Literal(v)
    }

    #[test]
    fn arithmetic_and_comparison() {
        let row = Row::new(vec![Value::Integer(3), Value::Integer(4)]);
        let add = BoundExpr::Binary {
            op: BinaryOp::Add,
            left: Box::new(col(0, DataType::Integer)),
            right: Box::new(col(1, DataType::Integer)),
            data_type: DataType::Integer,
        };
        assert_eq!(eval(&add, &row).unwrap(), Value::Integer(7));

        let gt = BoundExpr::Binary {
            op: BinaryOp::Gt,
            left: Box::new(col(1, DataType::Integer)),
            right: Box::new(col(0, DataType::Integer)),
            data_type: DataType::Boolean,
        };
        assert_eq!(eval(&gt, &row).unwrap(), Value::Boolean(true));
    }

    #[test]
    fn three_valued_and_or() {
        let row = Row::empty();
        let and = BoundExpr::Binary {
            op: BinaryOp::And,
            left: Box::new(lit(Value::Boolean(false))),
            right: Box::new(lit(Value::Null)),
            data_type: DataType::Boolean,
        };
        // FALSE AND NULL = FALSE
        assert_eq!(eval(&and, &row).unwrap(), Value::Boolean(false));

        let or = BoundExpr::Binary {
            op: BinaryOp::Or,
            left: Box::new(lit(Value::Boolean(false))),
            right: Box::new(lit(Value::Null)),
            data_type: DataType::Boolean,
        };
        // FALSE OR NULL = NULL
        assert!(eval(&or, &row).unwrap().is_null());
    }

    #[test]
    fn between_is_null_when_operand_null() {
        let row = Row::empty();
        let e = BoundExpr::Between {
            expr: Box::new(lit(Value::Null)),
            low: Box::new(lit(Value::Integer(1))),
            high: Box::new(lit(Value::Integer(9))),
            negated: false,
        };
        assert!(eval(&e, &row).unwrap().is_null());
    }

    #[test]
    fn in_list_semantics() {
        let row = Row::empty();
        let e = BoundExpr::InList {
            expr: Box::new(lit(Value::Integer(2))),
            list: vec![lit(Value::Integer(1)), lit(Value::Integer(2))],
            negated: false,
        };
        assert_eq!(eval(&e, &row).unwrap(), Value::Boolean(true));

        // 3 IN (1, NULL) => NULL (unknown), not FALSE
        let e2 = BoundExpr::InList {
            expr: Box::new(lit(Value::Integer(3))),
            list: vec![lit(Value::Integer(1)), lit(Value::Null)],
            negated: false,
        };
        assert!(eval(&e2, &row).unwrap().is_null());
    }

    #[test]
    fn searched_case() {
        let row = Row::new(vec![Value::Integer(5)]);
        let e = BoundExpr::Case {
            operand: None,
            when_then: vec![(
                BoundExpr::Binary {
                    op: BinaryOp::Gt,
                    left: Box::new(col(0, DataType::Integer)),
                    right: Box::new(lit(Value::Integer(3))),
                    data_type: DataType::Boolean,
                },
                lit(Value::text("big")),
            )],
            else_result: Some(Box::new(lit(Value::text("small")))),
            data_type: DataType::Text,
        };
        assert_eq!(eval(&e, &row).unwrap(), Value::text("big"));
    }
}
