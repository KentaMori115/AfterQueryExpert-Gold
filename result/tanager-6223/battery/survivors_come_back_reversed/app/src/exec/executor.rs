//! The executor: runs a [`LogicalPlan`] over the catalog, producing rows.
//!
//! Execution is fully materializing — each operator returns a `Vec<Row>`. This
//! keeps the engine simple and, crucially, deterministic: grouping and
//! deduplication preserve first-seen input order, and sorting is stable.

use crate::error::Result;
use crate::exec::eval::eval;
use crate::exec::{agg_exec, join_exec, sort_exec};
use crate::planner::logical::LogicalPlan;
use crate::storage::{Catalog, Row};
use crate::types::GroupKey;

/// Executes plans against a catalog.
pub struct Executor<'a> {
    catalog: &'a Catalog,
}

impl<'a> Executor<'a> {
    pub fn new(catalog: &'a Catalog) -> Executor<'a> {
        Executor { catalog }
    }

    /// Execute `plan`, returning its output rows.
    pub fn execute(&self, plan: &LogicalPlan) -> Result<Vec<Row>> {
        match plan {
            LogicalPlan::EmptyRow => Ok(vec![Row::empty()]),

            LogicalPlan::Scan { table, .. } => {
                let table = self.catalog.table(table)?;
                Ok(table.to_rows())
            }

            LogicalPlan::Filter { input, predicate } => {
                let rows = self.execute(input)?;
                let mut out = Vec::new();
                for row in rows {
                    if eval(predicate, &row)?.is_truthy() {
                        out.push(row);
                    }
                }
                Ok(out)
            }

            LogicalPlan::Project {
                input, expressions, ..
            } => {
                let rows = self.execute(input)?;
                let mut out = Vec::with_capacity(rows.len());
                for row in rows {
                    let mut values = Vec::with_capacity(expressions.len());
                    for e in expressions {
                        values.push(eval(e, &row)?);
                    }
                    out.push(Row::new(values));
                }
                Ok(out)
            }

            LogicalPlan::Aggregate {
                input,
                group_expr,
                aggregates,
                ..
            } => {
                let rows = self.execute(input)?;
                agg_exec::execute_aggregate(rows, group_expr, aggregates)
            }

            LogicalPlan::Sort { input, keys } => {
                let rows = self.execute(input)?;
                sort_exec::execute_sort(rows, keys)
            }

            LogicalPlan::Limit {
                input,
                limit,
                offset,
            } => {
                let rows = self.execute(input)?;
                let start = offset.unwrap_or(0) as usize;
                let mut sliced: Vec<Row> = rows.into_iter().skip(start).collect();
                if let Some(limit) = limit {
                    sliced.truncate(*limit as usize);
                }
                Ok(sliced)
            }

            LogicalPlan::Join {
                left,
                right,
                on,
                join_type,
                ..
            } => {
                let left_rows = self.execute(left)?;
                let right_rows = self.execute(right)?;
                let right_width = right.schema().len();
                join_exec::execute_join(left_rows, right_rows, on, *join_type, right_width)
            }

            LogicalPlan::Distinct { input } => {
                let rows = self.execute(input)?;
                let mut seen: std::collections::HashSet<Vec<GroupKey>> =
                    std::collections::HashSet::new();
                let mut out = Vec::new();
                for row in rows {
                    let key: Vec<GroupKey> = row.values().iter().map(|v| v.group_key()).collect();
                    if seen.insert(key) {
                        out.push(row);
                    }
                }
                Ok(out)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::statement::Statement;
    use crate::parser::parse_statement;
    use crate::planner::Binder;
    use crate::types::{DataType, Field, Schema, Value};

    fn seeded_catalog() -> Catalog {
        let mut c = Catalog::new();
        c.create_table(
            "nums",
            Schema::new(vec![
                Field::new("n", DataType::Integer),
                Field::new("grp", DataType::Text),
            ])
            .unwrap(),
        )
        .unwrap();
        let t = c.table_mut("nums").unwrap();
        for (n, g) in [(1, "a"), (2, "a"), (3, "b"), (4, "b"), (5, "b")] {
            t.insert_row(Row::new(vec![Value::Integer(n), Value::text(g)]))
                .unwrap();
        }
        c
    }

    fn run(c: &Catalog, sql: &str) -> Vec<Row> {
        let stmt = parse_statement(sql).unwrap();
        let plan = match stmt {
            Statement::Select(s) => Binder::new(c).bind_select(&s).unwrap(),
            _ => panic!("expected select"),
        };
        Executor::new(c).execute(&plan).unwrap()
    }

    #[test]
    fn filter_and_project() {
        let c = seeded_catalog();
        let rows = run(&c, "SELECT n FROM nums WHERE n >= 3");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].get(0), Some(&Value::Integer(3)));
    }

    #[test]
    fn group_by_aggregate() {
        let c = seeded_catalog();
        let rows = run(&c, "SELECT grp, COUNT(*), SUM(n) FROM nums GROUP BY grp");
        assert_eq!(rows.len(), 2);
        // group 'a': count 2 sum 3
        assert_eq!(rows[0].get(0), Some(&Value::text("a")));
        assert_eq!(rows[0].get(1), Some(&Value::Integer(2)));
        assert_eq!(rows[0].get(2), Some(&Value::Integer(3)));
        // group 'b': count 3 sum 12
        assert_eq!(rows[1].get(1), Some(&Value::Integer(3)));
        assert_eq!(rows[1].get(2), Some(&Value::Integer(12)));
    }

    #[test]
    fn bare_count_over_empty_is_zero() {
        let mut c = Catalog::new();
        c.create_table(
            "e",
            Schema::new(vec![Field::new("x", DataType::Integer)]).unwrap(),
        )
        .unwrap();
        let rows = run(&c, "SELECT COUNT(*) FROM e");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get(0), Some(&Value::Integer(0)));
    }

    #[test]
    fn order_by_desc_and_limit() {
        let c = seeded_catalog();
        let rows = run(&c, "SELECT n FROM nums ORDER BY n DESC LIMIT 2");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get(0), Some(&Value::Integer(5)));
        assert_eq!(rows[1].get(0), Some(&Value::Integer(4)));
    }

    #[test]
    fn having_filters_groups() {
        let c = seeded_catalog();
        let rows = run(&c, "SELECT grp FROM nums GROUP BY grp HAVING COUNT(*) > 2");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get(0), Some(&Value::text("b")));
    }

    #[test]
    fn distinct_dedups() {
        let c = seeded_catalog();
        let rows = run(&c, "SELECT DISTINCT grp FROM nums");
        assert_eq!(rows.len(), 2);
    }
}
