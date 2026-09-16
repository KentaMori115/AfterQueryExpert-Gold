//! Physical sorting: stable ordering by evaluated sort keys.

use std::cmp::Ordering;

use crate::ast::statement::SortDirection;
use crate::error::Result;
use crate::exec::eval::eval;
use crate::planner::logical::SortKey;
use crate::storage::Row;
use crate::types::Value;

/// Sort `rows` by `keys`.
///
/// The sort is stable, so rows with equal keys keep their input order. `NULL`
/// placement is governed solely by each key's `nulls_first` flag and is **not**
/// affected by `ASC`/`DESC`; only the ordering of non-null values is reversed
/// for a descending key.
pub(crate) fn execute_sort(rows: Vec<Row>, keys: &[SortKey]) -> Result<Vec<Row>> {
    // Precompute each row's sort key values once.
    let mut keyed: Vec<(Vec<Value>, Row)> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut kvs = Vec::with_capacity(keys.len());
        for k in keys {
            kvs.push(eval(&k.expr, &row)?);
        }
        keyed.push((kvs, row));
    }
    keyed.sort_by(|a, b| {
        for (i, key) in keys.iter().enumerate() {
            let (av, bv) = (&a.0[i], &b.0[i]);
            let ord = match (av.is_null(), bv.is_null()) {
                (true, true) => Ordering::Equal,
                (true, false) => {
                    if key.nulls_first {
                        Ordering::Less
                    } else {
                        Ordering::Greater
                    }
                }
                (false, true) => {
                    if key.nulls_first {
                        Ordering::Greater
                    } else {
                        Ordering::Less
                    }
                }
                (false, false) => {
                    let base = av.sort_cmp(bv, key.nulls_first);
                    if matches!(key.direction, SortDirection::Desc) {
                        base.reverse()
                    } else {
                        base
                    }
                }
            };
            if ord != Ordering::Equal {
                return ord;
            }
        }
        Ordering::Equal
    });
    Ok(keyed.into_iter().map(|(_, row)| row).collect())
}
