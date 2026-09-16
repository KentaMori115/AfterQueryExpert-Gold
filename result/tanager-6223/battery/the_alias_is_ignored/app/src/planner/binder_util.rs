//! Free helper functions used by the binder: naming, schema building, and the
//! type rules for operators and predicates.

use crate::ast::expr::Expr;
use crate::ast::operators::{BinaryOp, UnaryOp};
use crate::ast::statement::SelectItem;
use crate::error::{Error, Result};
use crate::planner::bound::BoundExpr;
use crate::planner::logical::LogicalPlan;
use crate::types::{DataType, Field, Schema};

pub(crate) fn projection_item_has_aggregate(item: &SelectItem) -> bool {
    match item {
        SelectItem::Expr { expr, .. } => expr.contains_aggregate(),
        _ => false,
    }
}

/// Derive an output column name for an unaliased projection expression.
pub(crate) fn derive_name(expr: &Expr) -> String {
    match expr {
        Expr::Column(cref) => cref.name.clone(),
        Expr::Function { name, .. } => name.to_lowercase(),
        Expr::Cast { expr, .. } => derive_name(expr),
        _ => "expr".to_string(),
    }
}

/// Append hidden columns to a `Project` node (used to carry ORDER BY keys that
/// are not part of the visible output).
pub(crate) fn extend_project(
    plan: LogicalPlan,
    mut extra_exprs: Vec<BoundExpr>,
    mut extra_names: Vec<String>,
) -> Result<LogicalPlan> {
    match plan {
        LogicalPlan::Project {
            input,
            mut expressions,
            mut aliases,
            ..
        } => {
            expressions.append(&mut extra_exprs);
            aliases.append(&mut extra_names);
            let schema = schema_from(&aliases, &expressions);
            Ok(LogicalPlan::Project {
                input,
                expressions,
                aliases,
                schema,
            })
        }
        _ => Err(Error::binder(
            "internal error: ORDER BY hidden columns require a projection",
        )),
    }
}

pub(crate) fn schema_from(names: &[String], exprs: &[BoundExpr]) -> Schema {
    let fields = names
        .iter()
        .zip(exprs)
        .map(|(n, e)| Field::new(n.clone(), e.data_type()))
        .collect();
    Schema::new_unchecked(fields)
}

pub(crate) fn require_predicate(ctx: &str, expr: &BoundExpr) -> Result<()> {
    match expr.data_type() {
        DataType::Boolean | DataType::Null => Ok(()),
        other => Err(Error::binder(format!(
            "{} requires a boolean expression, got {}",
            ctx, other
        ))),
    }
}

pub(crate) fn require_text_or_null(ctx: &str, dt: DataType) -> Result<()> {
    if dt == DataType::Text || dt == DataType::Null {
        Ok(())
    } else {
        Err(Error::binder(format!("{} requires TEXT, got {}", ctx, dt)))
    }
}

pub(crate) fn check_comparable(ctx: &str, a: DataType, b: DataType) -> Result<()> {
    if a.comparable_with(b) {
        Ok(())
    } else {
        Err(Error::binder(format!(
            "{} cannot compare {} with {}",
            ctx, a, b
        )))
    }
}

pub(crate) fn binary_result_type(
    op: BinaryOp,
    left: DataType,
    right: DataType,
) -> Result<DataType> {
    if op.is_concat() {
        let ok = |dt: DataType| dt == DataType::Text || dt == DataType::Null;
        if ok(left) && ok(right) {
            return Ok(DataType::Text);
        }
        return Err(Error::type_error(format!(
            "'||' requires TEXT operands, got {} and {}",
            left, right
        )));
    }
    if op.is_arithmetic() {
        left.arithmetic_result(right).ok_or_else(|| {
            Error::type_error(format!("cannot apply '{}' to {} and {}", op, left, right))
        })
    } else if op.is_comparison() {
        if left.comparable_with(right) {
            Ok(DataType::Boolean)
        } else {
            Err(Error::type_error(format!(
                "cannot compare {} with {} using '{}'",
                left, right, op
            )))
        }
    } else {
        // AND / OR
        let ok = |dt: DataType| dt == DataType::Boolean || dt == DataType::Null;
        if ok(left) && ok(right) {
            Ok(DataType::Boolean)
        } else {
            Err(Error::type_error(format!(
                "'{}' requires boolean operands, got {} and {}",
                op, left, right
            )))
        }
    }
}

pub(crate) fn unary_result_type(op: UnaryOp, operand: DataType) -> Result<DataType> {
    match op {
        UnaryOp::Negate => {
            if operand.is_numeric() || operand == DataType::Null {
                Ok(operand)
            } else {
                Err(Error::type_error(format!("cannot negate {}", operand)))
            }
        }
        UnaryOp::Not => {
            if operand == DataType::Boolean || operand == DataType::Null {
                Ok(DataType::Boolean)
            } else {
                Err(Error::type_error(format!(
                    "NOT requires boolean, got {}",
                    operand
                )))
            }
        }
    }
}

pub(crate) fn unify_result(ctx: &str, acc: DataType, next: DataType) -> Result<DataType> {
    acc.unify(next).ok_or_else(|| {
        Error::type_error(format!(
            "{} result types {} and {} are incompatible",
            ctx, acc, next
        ))
    })
}
