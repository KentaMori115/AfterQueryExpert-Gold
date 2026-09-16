//! The optimizer driver: applies rules to a fixpoint.

use crate::error::Result;
use crate::optimizer::constant_folding::ConstantFolding;
use crate::optimizer::limit_pushdown::LimitPushdown;
use crate::optimizer::predicate_pushdown::PredicatePushdown;
use crate::optimizer::rule::OptimizerRule;
use crate::planner::logical::LogicalPlan;

/// Runs a fixed pipeline of [`OptimizerRule`]s over a logical plan.
pub struct Optimizer {
    rules: Vec<Box<dyn OptimizerRule>>,
    max_passes: usize,
}

impl Optimizer {
    /// The default optimizer: constant folding followed by predicate pushdown.
    pub fn new() -> Optimizer {
        Optimizer {
            rules: vec![
                Box::new(ConstantFolding),
                Box::new(PredicatePushdown),
                Box::new(LimitPushdown),
            ],
            max_passes: 8,
        }
    }

    /// An optimizer with an explicit rule list (used in tests).
    pub fn with_rules(rules: Vec<Box<dyn OptimizerRule>>) -> Optimizer {
        Optimizer {
            rules,
            max_passes: 8,
        }
    }

    /// The names of the configured rules, in order.
    pub fn rule_names(&self) -> Vec<&'static str> {
        self.rules.iter().map(|r| r.name()).collect()
    }

    /// Optimize `plan`, iterating the rule pipeline until it reaches a fixpoint
    /// (no rule changes the plan) or `max_passes` is hit.
    pub fn optimize(&self, plan: LogicalPlan) -> Result<LogicalPlan> {
        let mut current = plan;
        for _ in 0..self.max_passes {
            let before = current.clone();
            for rule in &self.rules {
                current = rule.apply(current)?;
            }
            if current == before {
                break;
            }
        }
        Ok(current)
    }
}

impl Default for Optimizer {
    fn default() -> Self {
        Optimizer::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::statement::Statement;
    use crate::parser::parse_statement;
    use crate::planner::Binder;
    use crate::storage::Catalog;
    use crate::types::{DataType, Field, Schema};

    fn two_table_catalog() -> Catalog {
        let mut c = Catalog::new();
        c.create_table(
            "a",
            Schema::new(vec![
                Field::new("id", DataType::Integer),
                Field::new("x", DataType::Integer),
            ])
            .unwrap(),
        )
        .unwrap();
        c.create_table(
            "b",
            Schema::new(vec![
                Field::new("id", DataType::Integer),
                Field::new("y", DataType::Integer),
            ])
            .unwrap(),
        )
        .unwrap();
        c
    }

    fn optimized(sql: &str) -> LogicalPlan {
        let c = two_table_catalog();
        let plan = match parse_statement(sql).unwrap() {
            Statement::Select(s) => Binder::new(&c).bind_select(&s).unwrap(),
            _ => panic!(),
        };
        Optimizer::new().optimize(plan).unwrap()
    }

    #[test]
    fn rule_pipeline_is_stable() {
        assert_eq!(
            Optimizer::new().rule_names(),
            vec!["constant_folding", "predicate_pushdown", "limit_pushdown"]
        );
    }

    #[test]
    fn pushes_limit_below_projection() {
        let plan = optimized("SELECT a.id FROM a JOIN b ON a.id = b.id LIMIT 5");
        // Project should now sit above the Limit.
        assert_eq!(plan.node_name(), "Project");
        assert_eq!(plan.children()[0].node_name(), "Limit");
    }

    #[test]
    fn pushes_single_side_predicates_into_join_inputs() {
        // WHERE a.x > 1 AND b.y < 9 should push each side into its input.
        let plan = optimized("SELECT a.id FROM a JOIN b ON a.id = b.id WHERE a.x > 1 AND b.y < 9");
        // Project -> Join, and both join inputs are now Filters.
        let join = plan.children()[0];
        assert_eq!(join.node_name(), "Join");
        let left = join.children()[0];
        let right = join.children()[1];
        assert_eq!(left.node_name(), "Filter");
        assert_eq!(right.node_name(), "Filter");
    }

    #[test]
    fn keeps_cross_side_predicate_as_residual() {
        // a.x > b.y spans both sides: stays above the join.
        let plan = optimized("SELECT a.id FROM a JOIN b ON a.id = b.id WHERE a.x > b.y");
        let filter = plan.children()[0];
        assert_eq!(filter.node_name(), "Filter");
        assert_eq!(filter.children()[0].node_name(), "Join");
    }
}
