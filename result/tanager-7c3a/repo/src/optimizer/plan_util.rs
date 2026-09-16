//! Helpers for rebuilding logical plans during optimization.

use crate::error::Result;
use crate::planner::bound::BoundExpr;
use crate::planner::logical::LogicalPlan;

/// Apply `f` to every [`BoundExpr`] embedded in `plan` (predicates, projection
/// and aggregate expressions, sort keys, join conditions), recursing into child
/// plans first. Plan structure is preserved.
pub fn map_plan_expressions(
    plan: LogicalPlan,
    f: &dyn Fn(BoundExpr) -> Result<BoundExpr>,
) -> Result<LogicalPlan> {
    match plan {
        LogicalPlan::EmptyRow | LogicalPlan::Scan { .. } => Ok(plan),

        LogicalPlan::Filter { input, predicate } => {
            let input = Box::new(map_plan_expressions(*input, f)?);
            Ok(LogicalPlan::Filter {
                input,
                predicate: f(predicate)?,
            })
        }

        LogicalPlan::Project {
            input,
            expressions,
            aliases,
            schema,
        } => {
            let input = Box::new(map_plan_expressions(*input, f)?);
            let expressions = expressions.into_iter().map(f).collect::<Result<Vec<_>>>()?;
            Ok(LogicalPlan::Project {
                input,
                expressions,
                aliases,
                schema,
            })
        }

        LogicalPlan::Aggregate {
            input,
            group_expr,
            aggregates,
            schema,
        } => {
            let input = Box::new(map_plan_expressions(*input, f)?);
            let group_expr = group_expr.into_iter().map(f).collect::<Result<Vec<_>>>()?;
            let aggregates = aggregates
                .into_iter()
                .map(|mut agg| {
                    if let Some(arg) = agg.arg.take() {
                        agg.arg = Some(f(arg)?);
                    }
                    Ok(agg)
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(LogicalPlan::Aggregate {
                input,
                group_expr,
                aggregates,
                schema,
            })
        }

        LogicalPlan::Sort { input, keys } => {
            let input = Box::new(map_plan_expressions(*input, f)?);
            let keys = keys
                .into_iter()
                .map(|mut k| {
                    k.expr = f(k.expr)?;
                    Ok(k)
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(LogicalPlan::Sort { input, keys })
        }

        LogicalPlan::Limit {
            input,
            limit,
            offset,
        } => Ok(LogicalPlan::Limit {
            input: Box::new(map_plan_expressions(*input, f)?),
            limit,
            offset,
        }),

        LogicalPlan::Join {
            left,
            right,
            on,
            join_type,
            merged,
            schema,
        } => {
            let left = Box::new(map_plan_expressions(*left, f)?);
            let right = Box::new(map_plan_expressions(*right, f)?);
            Ok(LogicalPlan::Join {
                left,
                right,
                on: f(on)?,
                join_type,
                merged,
                schema,
            })
        }

        LogicalPlan::Distinct { input } => Ok(LogicalPlan::Distinct {
            input: Box::new(map_plan_expressions(*input, f)?),
        }),
    }
}
