//! The optimizer-rule interface.

use crate::error::Result;
use crate::planner::logical::LogicalPlan;

/// A logical-plan rewrite rule. Rules are pure: they take a plan and return a
/// (possibly) rewritten plan, never mutating in place.
pub trait OptimizerRule {
    /// A stable name for diagnostics.
    fn name(&self) -> &'static str;

    /// Rewrite `plan`. Returning the input unchanged means "no change".
    fn apply(&self, plan: LogicalPlan) -> Result<LogicalPlan>;
}
