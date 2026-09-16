//! Physical joins: nested-loop inner and left joins.

use crate::ast::statement::JoinType;
use crate::error::Result;
use crate::exec::eval::eval;
use crate::planner::bound::BoundExpr;
use crate::storage::Row;
use crate::types::Value;

/// Join `left_rows` and `right_rows` on the `on` predicate.
///
/// A nested-loop join. For `LEFT` joins, a left row with no matching right row
/// is emitted once, padded with `right_width` `NULL`s. Output preserves the
/// left-then-right row order, which keeps results deterministic.
pub(crate) fn execute_join(
    left_rows: Vec<Row>,
    right_rows: Vec<Row>,
    on: &BoundExpr,
    join_type: JoinType,
    right_width: usize,
) -> Result<Vec<Row>> {
    let mut out = Vec::new();
    let null_right = Row::new(vec![Value::Null; right_width]);
    for l in &left_rows {
        let mut matched = false;
        for r in &right_rows {
            let combined = l.concat(r);
            if eval(on, &combined)?.is_truthy() {
                matched = true;
                out.push(combined);
            }
        }
        if !matched && matches!(join_type, JoinType::Left) {
            out.push(l.concat(&null_right));
        }
    }
    Ok(out)
}
