//! Shared expression utilities for optimizer rules: column rewriting and
//! `AND`-conjunct splitting/combining.

use crate::ast::operators::BinaryOp;
use crate::planner::bound::BoundExpr;
use crate::types::DataType;

/// Rebuild `expr`, applying `map` to every column index it references
/// (bottom-up). Used to re-base predicates when pushing them across a join.
pub fn rewrite_columns(expr: BoundExpr, map: &dyn Fn(usize) -> usize) -> BoundExpr {
    // map_children only fails if the closure fails; ours never does.
    let rebuilt = expr
        .map_children(&mut |c| Ok(rewrite_columns(c, map)))
        .expect("rewrite_columns is infallible");
    match rebuilt {
        BoundExpr::Column { index, data_type } => BoundExpr::Column {
            index: map(index),
            data_type,
        },
        other => other,
    }
}

/// Split a predicate into its top-level `AND` conjuncts.
pub fn split_conjuncts(expr: BoundExpr) -> Vec<BoundExpr> {
    let mut out = Vec::new();
    collect_conjuncts(expr, &mut out);
    out
}

fn collect_conjuncts(expr: BoundExpr, out: &mut Vec<BoundExpr>) {
    match expr {
        BoundExpr::Binary {
            op: BinaryOp::And,
            left,
            right,
            ..
        } => {
            collect_conjuncts(*left, out);
            collect_conjuncts(*right, out);
        }
        other => out.push(other),
    }
}

/// Combine conjuncts back into a single `AND` chain, or `None` if empty.
pub fn combine_conjuncts(mut conjuncts: Vec<BoundExpr>) -> Option<BoundExpr> {
    if conjuncts.is_empty() {
        return None;
    }
    let mut acc = conjuncts.remove(0);
    for c in conjuncts {
        acc = BoundExpr::Binary {
            op: BinaryOp::And,
            left: Box::new(acc),
            right: Box::new(c),
            data_type: DataType::Boolean,
        };
    }
    Some(acc)
}

/// The inclusive `[min, max]` range of column indices referenced by `expr`, or
/// `None` if it references no columns (a constant).
pub fn column_range(expr: &BoundExpr) -> Option<(usize, usize)> {
    let mut min = usize::MAX;
    let mut max = 0usize;
    let mut any = false;
    expr.walk(&mut |e| {
        if let BoundExpr::Column { index, .. } = e {
            any = true;
            min = min.min(*index);
            max = max.max(*index);
        }
    });
    if any {
        Some((min, max))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Value;

    fn col(i: usize) -> BoundExpr {
        BoundExpr::Column {
            index: i,
            data_type: DataType::Integer,
        }
    }

    #[test]
    fn splits_and_recombines() {
        let pred = BoundExpr::Binary {
            op: BinaryOp::And,
            left: Box::new(BoundExpr::Binary {
                op: BinaryOp::And,
                left: Box::new(col(0)),
                right: Box::new(col(1)),
                data_type: DataType::Boolean,
            }),
            right: Box::new(col(2)),
            data_type: DataType::Boolean,
        };
        let parts = split_conjuncts(pred);
        assert_eq!(parts.len(), 3);
        assert!(combine_conjuncts(parts).is_some());
    }

    #[test]
    fn remaps_column_indices() {
        let e = BoundExpr::Binary {
            op: BinaryOp::Eq,
            left: Box::new(col(4)),
            right: Box::new(BoundExpr::Literal(Value::Integer(1))),
            data_type: DataType::Boolean,
        };
        let shifted = rewrite_columns(e, &|i| i - 2);
        assert_eq!(column_range(&shifted), Some((2, 2)));
    }
}
