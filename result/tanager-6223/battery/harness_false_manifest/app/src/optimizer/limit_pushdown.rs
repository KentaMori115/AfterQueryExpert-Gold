//! Limit pushdown: move a `Limit` below a `Project`.

use crate::error::Result;
use crate::optimizer::rule::OptimizerRule;
use crate::planner::logical::LogicalPlan;

/// Pushes a `Limit` beneath a `Project`.
///
/// A projection maps rows one-to-one, so applying the limit *before* the
/// projection produces the same rows while projecting fewer of them. The limit
/// is not pushed below cardinality-changing operators (filter, join, aggregate,
/// sort, distinct), where it would change results.
pub struct LimitPushdown;

impl OptimizerRule for LimitPushdown {
    fn name(&self) -> &'static str {
        "limit_pushdown"
    }

    fn apply(&self, plan: LogicalPlan) -> Result<LogicalPlan> {
        Ok(pushdown(plan))
    }
}

fn pushdown(plan: LogicalPlan) -> LogicalPlan {
    // Rebuild children first.
    let plan = map_children(plan);

    if let LogicalPlan::Limit {
        input,
        limit,
        offset,
    } = plan
    {
        if let LogicalPlan::Project {
            input: proj_input,
            expressions,
            aliases,
            schema,
        } = *input
        {
            let new_limit = LogicalPlan::Limit {
                input: proj_input,
                limit,
                offset,
            };
            return LogicalPlan::Project {
                input: Box::new(new_limit),
                expressions,
                aliases,
                schema,
            };
        }
        return LogicalPlan::Limit {
            input,
            limit,
            offset,
        };
    }
    plan
}

/// Apply the rewrite to a node's children, preserving the node itself.
fn map_children(plan: LogicalPlan) -> LogicalPlan {
    match plan {
        LogicalPlan::EmptyRow | LogicalPlan::Scan { .. } => plan,
        LogicalPlan::Filter { input, predicate } => LogicalPlan::Filter {
            input: Box::new(pushdown(*input)),
            predicate,
        },
        LogicalPlan::Project {
            input,
            expressions,
            aliases,
            schema,
        } => LogicalPlan::Project {
            input: Box::new(pushdown(*input)),
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
            input: Box::new(pushdown(*input)),
            group_expr,
            aggregates,
            schema,
        },
        LogicalPlan::Sort { input, keys } => LogicalPlan::Sort {
            input: Box::new(pushdown(*input)),
            keys,
        },
        LogicalPlan::Limit {
            input,
            limit,
            offset,
        } => LogicalPlan::Limit {
            input: Box::new(pushdown(*input)),
            limit,
            offset,
        },
        LogicalPlan::Join {
            left,
            right,
            on,
            join_type,
            schema,
        } => LogicalPlan::Join {
            left: Box::new(pushdown(*left)),
            right: Box::new(pushdown(*right)),
            on,
            join_type,
            schema,
        },
        LogicalPlan::Distinct { input } => LogicalPlan::Distinct {
            input: Box::new(pushdown(*input)),
        },
    }
}
