//! Constant folding: replace constant subexpressions with literals.

use crate::error::Result;
use crate::exec::eval::eval;
use crate::optimizer::rule::OptimizerRule;
use crate::planner::bound::BoundExpr;
use crate::planner::logical::LogicalPlan;
use crate::storage::Row;

use super::plan_util::map_plan_expressions;

/// Folds constant expressions (those referencing no columns) into literals.
///
/// Folding is *conservative*: a constant subexpression whose evaluation fails
/// (for example `1 / 0`) is left untouched, so guarded expressions such as a
/// `CASE` branch that is never taken keep their runtime semantics rather than
/// raising an error at plan time.
pub struct ConstantFolding;

impl OptimizerRule for ConstantFolding {
    fn name(&self) -> &'static str {
        "constant_folding"
    }

    fn apply(&self, plan: LogicalPlan) -> Result<LogicalPlan> {
        map_plan_expressions(plan, &|expr| Ok(fold(expr)))
    }
}

/// Fold an expression bottom-up.
pub fn fold(expr: BoundExpr) -> BoundExpr {
    // Fold children first; map_children with an infallible closure never errors.
    let folded = expr
        .map_children(&mut |c| Ok(fold(c)))
        .expect("fold is infallible");

    if let BoundExpr::Literal(_) = folded {
        return folded;
    }
    if folded.is_constant() {
        // Evaluate against an empty row; keep the original on any failure.
        if let Ok(value) = eval(&folded, &Row::empty()) {
            return BoundExpr::Literal(value);
        }
    }
    folded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::operators::BinaryOp;
    use crate::types::{DataType, Value};

    #[test]
    fn folds_constant_arithmetic() {
        // 2 * (3 + 4) => 14
        let e = BoundExpr::Binary {
            op: BinaryOp::Multiply,
            left: Box::new(BoundExpr::Literal(Value::Integer(2))),
            right: Box::new(BoundExpr::Binary {
                op: BinaryOp::Add,
                left: Box::new(BoundExpr::Literal(Value::Integer(3))),
                right: Box::new(BoundExpr::Literal(Value::Integer(4))),
                data_type: DataType::Integer,
            }),
            data_type: DataType::Integer,
        };
        assert_eq!(fold(e), BoundExpr::Literal(Value::Integer(14)));
    }

    #[test]
    fn keeps_column_expressions() {
        let e = BoundExpr::Binary {
            op: BinaryOp::Add,
            left: Box::new(BoundExpr::Column {
                index: 0,
                data_type: DataType::Integer,
            }),
            right: Box::new(BoundExpr::Literal(Value::Integer(1))),
            data_type: DataType::Integer,
        };
        // Not constant: unchanged.
        assert_eq!(fold(e.clone()), e);
    }

    #[test]
    fn does_not_fold_division_by_zero() {
        let e = BoundExpr::Binary {
            op: BinaryOp::Divide,
            left: Box::new(BoundExpr::Literal(Value::Integer(1))),
            right: Box::new(BoundExpr::Literal(Value::Integer(0))),
            data_type: DataType::Integer,
        };
        // Left unfolded because evaluation errors.
        assert!(matches!(fold(e), BoundExpr::Binary { .. }));
    }
}
