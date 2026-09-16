//! Physical aggregation: grouping rows and computing accumulators.

use std::collections::HashMap;

use crate::error::Result;
use crate::exec::eval::eval;
use crate::functions::Accumulator;
use crate::planner::bound::{BoundAggregate, BoundExpr};
use crate::storage::Row;
use crate::types::{GroupKey, Value};

/// Group `rows` by `group_expr` and compute `aggregates` per group.
///
/// Groups are emitted in first-seen input order (an ordered map plus an
/// insertion-ordered vector), so the output is deterministic. A grouped
/// aggregate over zero rows yields zero groups; a *bare* aggregate (no
/// `GROUP BY`) over zero rows still yields exactly one row.
pub(crate) fn execute_aggregate(
    rows: Vec<Row>,
    group_expr: &[BoundExpr],
    aggregates: &[BoundAggregate],
) -> Result<Vec<Row>> {
    let mut index: HashMap<Vec<GroupKey>, usize> = HashMap::new();
    let mut order: Vec<Vec<Value>> = Vec::new();
    let mut states: Vec<Vec<Accumulator>> = Vec::new();

    let fresh = || {
        aggregates
            .iter()
            .map(|a| a.func.accumulator(a.distinct))
            .collect::<Vec<_>>()
    };

    if group_expr.is_empty() {
        order.push(Vec::new());
        states.push(fresh());
        index.insert(Vec::new(), 0);
    }

    for row in &rows {
        let mut key_values = Vec::with_capacity(group_expr.len());
        for g in group_expr {
            key_values.push(eval(g, row)?);
        }
        let key: Vec<GroupKey> = key_values.iter().map(|v| v.group_key()).collect();
        let slot = match index.get(&key) {
            Some(&i) => i,
            None => {
                let i = order.len();
                index.insert(key, i);
                order.push(key_values);
                states.push(fresh());
                i
            }
        };
        for (acc, agg) in states[slot].iter_mut().zip(aggregates) {
            match &agg.arg {
                None => acc.update_count_star(),
                Some(arg) => {
                    let v = eval(arg, row)?;
                    acc.update(&v)?;
                }
            }
        }
    }

    let mut out = Vec::with_capacity(order.len());
    for (key_values, accs) in order.into_iter().zip(states) {
        let mut values = key_values;
        for acc in accs {
            values.push(acc.finish()?);
        }
        out.push(Row::new(values));
    }
    Ok(out)
}
