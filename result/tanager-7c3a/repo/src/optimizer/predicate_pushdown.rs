//! Predicate pushdown: move filter conjuncts closer to the scans they constrain.

use crate::error::Result;
use crate::optimizer::conjuncts::{
    column_range, combine_conjuncts, rewrite_columns, split_conjuncts,
};
use crate::optimizer::rule::OptimizerRule;
use crate::planner::bound::BoundExpr;
use crate::planner::logical::LogicalPlan;

/// Pushes `Filter` conjuncts through a `Join` into the join's inputs when a
/// conjunct references only one side.
///
/// A side may only take a conjunct when the join cannot null-extend it. A left
/// join emits a left row that matched nothing, padded with `NULL`s on the
/// right, so a right-only conjunct above it would reject that padded row while
/// the same conjunct inside the right input would not: the rewrite has to leave
/// it above. A right join says the same of the left side and a full join of
/// both, which leaves inner and cross joins as the only ones that take a
/// conjunct on either side. Anything spanning both sides (or a constant) stays
/// as a residual filter above the join.
///
/// A join that merges `USING` columns is left alone entirely. Its output frame
/// is not the left-then-right frame the conjunct's column indices were bound
/// against, so no index in the filter re-bases onto an input without first
/// being mapped back through the merge.
pub struct PredicatePushdown;

impl OptimizerRule for PredicatePushdown {
    fn name(&self) -> &'static str {
        "predicate_pushdown"
    }

    fn apply(&self, plan: LogicalPlan) -> Result<LogicalPlan> {
        pushdown(plan)
    }
}

fn pushdown(plan: LogicalPlan) -> Result<LogicalPlan> {
    // Recurse into children first.
    let plan = recurse_children(plan)?;

    if let LogicalPlan::Filter { input, predicate } = plan {
        if let LogicalPlan::Join {
            left,
            right,
            on,
            join_type,
            merged,
            schema,
        } = *input
        {
            if !merged.is_empty() {
                return Ok(LogicalPlan::Filter {
                    input: Box::new(LogicalPlan::Join {
                        left,
                        right,
                        on,
                        join_type,
                        merged,
                        schema,
                    }),
                    predicate,
                });
            }
            let left_width = left.schema().len();
            let takes_left = !join_type.keeps_unmatched_right();
            let takes_right = !join_type.keeps_unmatched_left();
            let mut to_left = Vec::new();
            let mut to_right = Vec::new();
            let mut residual = Vec::new();

            for conjunct in split_conjuncts(predicate) {
                match column_range(&conjunct) {
                    Some((_, max)) if max < left_width && takes_left => to_left.push(conjunct),
                    Some((min, _)) if min >= left_width && takes_right => {
                        // Re-base right-only indices to the right input's frame.
                        to_right.push(rewrite_columns(conjunct, &|i| i - left_width));
                    }
                    _ => residual.push(conjunct),
                }
            }

            let new_left = wrap_filter(*left, to_left);
            let new_right = wrap_filter(*right, to_right);
            let new_join = LogicalPlan::Join {
                left: Box::new(new_left),
                right: Box::new(new_right),
                on,
                join_type,
                merged,
                schema,
            };
            return Ok(match combine_conjuncts(residual) {
                Some(pred) => LogicalPlan::Filter {
                    input: Box::new(new_join),
                    predicate: pred,
                },
                None => new_join,
            });
        }
        // Not a filter-over-join: rebuild unchanged.
        return Ok(LogicalPlan::Filter { input, predicate });
    }

    Ok(plan)
}

/// Wrap `plan` in a `Filter` for the given conjuncts, or return it unchanged if
/// there are none.
fn wrap_filter(plan: LogicalPlan, conjuncts: Vec<BoundExpr>) -> LogicalPlan {
    match combine_conjuncts(conjuncts) {
        Some(predicate) => LogicalPlan::Filter {
            input: Box::new(plan),
            predicate,
        },
        None => plan,
    }
}

/// Apply pushdown to a node's children, preserving the node itself.
fn recurse_children(plan: LogicalPlan) -> Result<LogicalPlan> {
    Ok(match plan {
        LogicalPlan::EmptyRow | LogicalPlan::Scan { .. } => plan,
        LogicalPlan::Filter { input, predicate } => LogicalPlan::Filter {
            input: Box::new(pushdown(*input)?),
            predicate,
        },
        LogicalPlan::Project {
            input,
            expressions,
            aliases,
            schema,
        } => LogicalPlan::Project {
            input: Box::new(pushdown(*input)?),
            expressions,
            aliases,
            schema,
        },
        LogicalPlan::Aggregate {
            input,
            group_expr,
            aggregates,
            schema,
        } => LogicalPlan::Aggregate {
            input: Box::new(pushdown(*input)?),
            group_expr,
            aggregates,
            schema,
        },
        LogicalPlan::Sort { input, keys } => LogicalPlan::Sort {
            input: Box::new(pushdown(*input)?),
            keys,
        },
        LogicalPlan::Limit {
            input,
            limit,
            offset,
        } => LogicalPlan::Limit {
            input: Box::new(pushdown(*input)?),
            limit,
            offset,
        },
        LogicalPlan::Join {
            left,
            right,
            on,
            join_type,
            merged,
            schema,
        } => LogicalPlan::Join {
            left: Box::new(pushdown(*left)?),
            right: Box::new(pushdown(*right)?),
            on,
            join_type,
            merged,
            schema,
        },
        LogicalPlan::Distinct { input } => LogicalPlan::Distinct {
            input: Box::new(pushdown(*input)?),
        },
    })
}
