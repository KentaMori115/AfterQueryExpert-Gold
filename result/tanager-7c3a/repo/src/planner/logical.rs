//! The logical plan: a tree of relational operators over bound expressions.

use std::sync::OnceLock;

use crate::ast::statement::{JoinType, SortDirection};
use crate::planner::bound::{BoundAggregate, BoundExpr};
use crate::types::Schema;

/// One `ORDER BY` key in a [`LogicalPlan::Sort`].
#[derive(Debug, Clone, PartialEq)]
pub struct SortKey {
    pub expr: BoundExpr,
    pub direction: SortDirection,
    pub nulls_first: bool,
}

/// A node in the logical query plan.
///
/// Each node knows its own output [`Schema`]. Pass-through nodes (filter, sort,
/// limit, distinct) delegate to their input; producing nodes (scan, project,
/// aggregate, join) store the schema they compute.
#[derive(Debug, Clone, PartialEq)]
pub enum LogicalPlan {
    /// A single row with zero columns — the input to a `SELECT` with no `FROM`.
    EmptyRow,
    /// Read a base table.
    Scan { table: String, schema: Schema },
    /// Keep only rows for which `predicate` is `TRUE`.
    Filter {
        input: Box<LogicalPlan>,
        predicate: BoundExpr,
    },
    /// Compute output columns from `expressions`, named by `aliases`.
    Project {
        input: Box<LogicalPlan>,
        expressions: Vec<BoundExpr>,
        aliases: Vec<String>,
        schema: Schema,
    },
    /// Group by `group_expr` and compute `aggregates`. Output row layout is the
    /// group columns followed by the aggregate columns.
    Aggregate {
        input: Box<LogicalPlan>,
        group_expr: Vec<BoundExpr>,
        aggregates: Vec<BoundAggregate>,
        schema: Schema,
    },
    /// Order rows by `keys`.
    Sort {
        input: Box<LogicalPlan>,
        keys: Vec<SortKey>,
    },
    /// Skip `offset` rows then keep at most `limit`.
    Limit {
        input: Box<LogicalPlan>,
        limit: Option<u64>,
        offset: Option<u64>,
    },
    /// Join two inputs on `on`.
    ///
    /// The predicate reads a row of the left columns followed by the right
    /// ones. Output is that same frame unless `merged` is non-empty: each
    /// `(left, right)` pair there is one column of `USING`, and the output
    /// frame becomes the merged columns, then the left columns no pair names,
    /// then the right columns no pair names.
    Join {
        left: Box<LogicalPlan>,
        right: Box<LogicalPlan>,
        on: BoundExpr,
        join_type: JoinType,
        merged: Vec<(usize, usize)>,
        schema: Schema,
    },
    /// Remove duplicate rows.
    Distinct { input: Box<LogicalPlan> },
}

fn empty_schema() -> &'static Schema {
    static EMPTY: OnceLock<Schema> = OnceLock::new();
    EMPTY.get_or_init(Schema::empty)
}

impl LogicalPlan {
    /// The output schema of this node.
    pub fn schema(&self) -> &Schema {
        match self {
            LogicalPlan::EmptyRow => empty_schema(),
            LogicalPlan::Scan { schema, .. } => schema,
            LogicalPlan::Project { schema, .. } => schema,
            LogicalPlan::Aggregate { schema, .. } => schema,
            LogicalPlan::Join { schema, .. } => schema,
            LogicalPlan::Filter { input, .. }
            | LogicalPlan::Sort { input, .. }
            | LogicalPlan::Limit { input, .. }
            | LogicalPlan::Distinct { input } => input.schema(),
        }
    }

    /// A short node label for plan display / debugging.
    pub fn node_name(&self) -> &'static str {
        match self {
            LogicalPlan::EmptyRow => "EmptyRow",
            LogicalPlan::Scan { .. } => "Scan",
            LogicalPlan::Filter { .. } => "Filter",
            LogicalPlan::Project { .. } => "Project",
            LogicalPlan::Aggregate { .. } => "Aggregate",
            LogicalPlan::Sort { .. } => "Sort",
            LogicalPlan::Limit { .. } => "Limit",
            LogicalPlan::Join { .. } => "Join",
            LogicalPlan::Distinct { .. } => "Distinct",
        }
    }

    /// The child plans of this node, left to right.
    pub fn children(&self) -> Vec<&LogicalPlan> {
        match self {
            LogicalPlan::EmptyRow | LogicalPlan::Scan { .. } => Vec::new(),
            LogicalPlan::Filter { input, .. }
            | LogicalPlan::Project { input, .. }
            | LogicalPlan::Aggregate { input, .. }
            | LogicalPlan::Sort { input, .. }
            | LogicalPlan::Limit { input, .. }
            | LogicalPlan::Distinct { input } => vec![input],
            LogicalPlan::Join { left, right, .. } => vec![left, right],
        }
    }

    /// A one-line detail string for this node (operator-specific attributes).
    pub fn detail(&self) -> String {
        match self {
            LogicalPlan::EmptyRow => "EmptyRow".to_string(),
            LogicalPlan::Scan { table, .. } => format!("Scan {}", table),
            LogicalPlan::Filter { .. } => "Filter".to_string(),
            LogicalPlan::Project { expressions, .. } => {
                format!("Project ({} cols)", expressions.len())
            }
            LogicalPlan::Aggregate {
                group_expr,
                aggregates,
                ..
            } => format!(
                "Aggregate (groups={}, aggs={})",
                group_expr.len(),
                aggregates.len()
            ),
            LogicalPlan::Sort { keys, .. } => format!("Sort ({} keys)", keys.len()),
            LogicalPlan::Limit { limit, offset, .. } => match (limit, offset) {
                (Some(l), Some(o)) => format!("Limit {} Offset {}", l, o),
                (Some(l), None) => format!("Limit {}", l),
                (None, Some(o)) => format!("Offset {}", o),
                (None, None) => "Limit".to_string(),
            },
            LogicalPlan::Join {
                join_type, merged, ..
            } => match merged.len() {
                0 => join_type.keyword().to_string(),
                n => format!("{} (merging {} cols)", join_type.keyword(), n),
            },
            LogicalPlan::Distinct { .. } => "Distinct".to_string(),
        }
    }

    /// Render the plan as an indented tree (one node per line, with details).
    pub fn explain(&self) -> String {
        let mut out = String::new();
        self.explain_into(&mut out, 0);
        out
    }

    /// The plan tree as one detail string per line (no trailing newline).
    pub fn explain_lines(&self) -> Vec<String> {
        self.explain().lines().map(|s| s.to_string()).collect()
    }

    fn explain_into(&self, out: &mut String, depth: usize) {
        for _ in 0..depth {
            out.push_str("  ");
        }
        out.push_str(&self.detail());
        out.push('\n');
        for child in self.children() {
            child.explain_into(out, depth + 1);
        }
    }
}
