//! Physical joins: nested-loop inner, one-sided outer, full outer and cross.

use crate::ast::statement::JoinType;
use crate::error::Result;
use crate::exec::eval::eval;
use crate::planner::bound::BoundExpr;
use crate::storage::Row;
use crate::types::{DataType, Value};

/// Join `left_rows` and `right_rows` on the `on` predicate.
///
/// A nested-loop join. The predicate reads a pairing as the left row followed
/// by the right row; `CROSS` joins ignore it and take every pairing. A left row
/// that matched nothing is emitted once with `right_width` `NULL`s appended
/// when the join keeps unmatched left rows, and a right row that nothing
/// matched is emitted with `left_width` `NULL`s prepended when the join keeps
/// unmatched right rows.
///
/// Output order is left-driven: pairings in left order, then within one left
/// row in right order, and last the right rows nothing matched, in right order.
///
/// `merged` names the `USING` column pairs as `(left, right)` positions in the
/// pairing frame. Each pair collapses to one output column carrying whichever
/// side is not null, and those columns lead the output row, ahead of the left
/// and then right columns no pair names. `merged_types` holds the type each of
/// those columns settled on, so a pair of unequal numeric widths reads back as
/// one type rather than as whichever side supplied the row.
pub(crate) fn execute_join(
    left_rows: Vec<Row>,
    right_rows: Vec<Row>,
    on: &BoundExpr,
    join_type: JoinType,
    left_width: usize,
    right_width: usize,
    merged: &[(usize, usize)],
    merged_types: &[DataType],
) -> Result<Vec<Row>> {
    let layout = Layout::new(left_width, right_width, merged, merged_types);
    let null_right = vec![Value::Null; right_width];
    let null_left = vec![Value::Null; left_width];

    let mut out = Vec::new();
    let mut right_matched = vec![false; right_rows.len()];

    for l in &left_rows {
        let mut matched = false;
        for (j, r) in right_rows.iter().enumerate() {
            let paired = l.concat(r);
            let keep = match join_type {
                JoinType::Cross => true,
                _ => eval(on, &paired)?.is_truthy(),
            };
            if keep {
                matched = true;
                right_matched[j] = true;
                out.push(layout.emit(&paired)?);
            }
        }
        if !matched && join_type.keeps_unmatched_left() {
            out.push(layout.emit(&l.concat(&Row::new(null_right.clone())))?);
        }
    }

    if join_type.keeps_unmatched_right() {
        for (j, r) in right_rows.iter().enumerate() {
            if !right_matched[j] {
                out.push(layout.emit(&Row::new(null_left.clone()).concat(r))?);
            }
        }
    }

    Ok(out)
}

/// How a pairing of left and right columns becomes an output row.
struct Layout {
    merged: Vec<(usize, usize)>,
    merged_types: Vec<DataType>,
    carried: Vec<usize>,
}

impl Layout {
    fn new(
        left_width: usize,
        right_width: usize,
        merged: &[(usize, usize)],
        merged_types: &[DataType],
    ) -> Layout {
        let mut hidden = vec![false; left_width + right_width];
        for &(l, r) in merged {
            hidden[l] = true;
            hidden[r] = true;
        }
        let carried = (0..left_width + right_width)
            .filter(|&i| !hidden[i])
            .collect();
        Layout {
            merged: merged.to_vec(),
            merged_types: merged_types.to_vec(),
            carried,
        }
    }

    /// Build one output row from a pairing.
    fn emit(&self, paired: &Row) -> Result<Row> {
        if self.merged.is_empty() {
            return Ok(paired.clone());
        }
        let mut values = Vec::with_capacity(self.merged.len() + self.carried.len());
        for (k, &(l, r)) in self.merged.iter().enumerate() {
            let left = paired.get(l).cloned().unwrap_or(Value::Null);
            let taken = if left.is_null() {
                paired.get(r).cloned().unwrap_or(Value::Null)
            } else {
                left
            };
            let target = self.merged_types.get(k).copied().unwrap_or(DataType::Null);
            values.push(settle(taken, target)?);
        }
        for &i in &self.carried {
            values.push(paired.get(i).cloned().unwrap_or(Value::Null));
        }
        Ok(Row::new(values))
    }
}

/// Bring a merged value to the type the column settled on, the way a `CASE`
/// widens one of its branches.
fn settle(value: Value, data_type: DataType) -> Result<Value> {
    if value.is_null() || data_type == DataType::Null || value.data_type() == data_type {
        Ok(value)
    } else {
        value.cast(data_type)
    }
}
