//! Rule-based logical-plan optimization.

pub mod conjuncts;
pub mod constant_folding;
pub mod limit_pushdown;
#[allow(clippy::module_inception)]
pub mod optimizer;
pub mod plan_util;
pub mod predicate_pushdown;
pub mod rule;

pub use constant_folding::ConstantFolding;
pub use limit_pushdown::LimitPushdown;
pub use optimizer::Optimizer;
pub use predicate_pushdown::PredicatePushdown;
pub use rule::OptimizerRule;
