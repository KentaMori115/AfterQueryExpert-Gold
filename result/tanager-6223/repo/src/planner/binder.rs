//! The binder: resolves an AST against a catalog into a typed [`LogicalPlan`].
//!
//! Binding performs name resolution (columns → positional indices), type
//! checking (every node gets a [`DataType`]), and the lifting of aggregate
//! calls out of projection/`HAVING` expressions into an [`LogicalPlan::Aggregate`]
//! node. Scalar and aggregate binding share one recursive core parameterized by
//! an optional aggregate context.

use crate::ast::expr::{is_aggregate_name, Expr};
use crate::ast::statement::{FromClause, SelectItem, SelectStmt};
use crate::error::{Error, Result};
use crate::functions::{AggregateFn, ScalarFn};
use crate::planner::binder_util::{
    binary_result_type, check_comparable, derive_name, extend_project,
    projection_item_has_aggregate, require_predicate, require_text_or_null, schema_from,
    unary_result_type, unify_result,
};
use crate::planner::bound::{BoundAggregate, BoundExpr};
use crate::planner::logical::{LogicalPlan, SortKey};
use crate::planner::scope::Scope;
use crate::storage::Catalog;
use crate::types::{DataType, Field, Schema};

/// Binds AST statements against a catalog snapshot.
pub struct Binder<'a> {
    catalog: &'a Catalog,
}

/// Aggregate-binding context threaded through the expression core while binding
/// a projection/`HAVING` under `GROUP BY`.
struct AggCtx<'a> {
    /// The `GROUP BY` expressions, matched structurally against subexpressions.
    group_exprs: &'a [Expr],
    /// Accumulated aggregate calls (grows as they are discovered).
    aggregates: &'a mut Vec<BoundAggregate>,
    /// Number of leading group columns in the aggregate output row.
    group_count: usize,
}

impl<'a> Binder<'a> {
    pub fn new(catalog: &'a Catalog) -> Binder<'a> {
        Binder { catalog }
    }

    /// Bind a `SELECT` into a logical plan.
    pub fn bind_select(&self, select: &SelectStmt) -> Result<LogicalPlan> {
        let (mut plan, scope) = match &select.from {
            None => (LogicalPlan::EmptyRow, Scope::empty()),
            Some(from) => self.bind_from(from)?,
        };

        if let Some(pred) = &select.selection {
            let predicate = self.bind_scalar(pred, &scope)?;
            require_predicate("WHERE", &predicate)?;
            plan = LogicalPlan::Filter {
                input: Box::new(plan),
                predicate,
            };
        }

        let aggregating = !select.group_by.is_empty()
            || select.projection.iter().any(projection_item_has_aggregate)
            || select
                .having
                .as_ref()
                .map(|h| h.contains_aggregate())
                .unwrap_or(false);

        if aggregating {
            plan = self.bind_aggregate(plan, &scope, select)?;
        } else {
            if select.having.is_some() {
                return Err(Error::binder(
                    "HAVING requires GROUP BY or an aggregate function",
                ));
            }
            let (expressions, aliases, schema) =
                self.bind_projection(&select.projection, &scope)?;
            plan = LogicalPlan::Project {
                input: Box::new(plan),
                expressions,
                aliases,
                schema,
            };
        }

        // Columns visible to the caller (before any hidden ORDER BY columns).
        let visible_count = plan.schema().len();
        // Non-aggregate, non-distinct queries may ORDER BY input columns that
        // are not projected; such keys are carried as hidden columns.
        let order_input_scope = if !aggregating && !select.distinct {
            Some(&scope)
        } else {
            None
        };

        if select.distinct {
            plan = LogicalPlan::Distinct {
                input: Box::new(plan),
            };
        }

        if !select.order_by.is_empty() {
            plan = self.build_sort(plan, select, order_input_scope, visible_count)?;
        }

        if select.limit.is_some() || select.offset.is_some() {
            plan = LogicalPlan::Limit {
                input: Box::new(plan),
                limit: select.limit,
                offset: select.offset,
            };
        }

        Ok(plan)
    }

    /// Bind a standalone scalar expression against an explicit scope (used by
    /// `INSERT` value binding via an empty scope).
    pub fn bind_scalar(&self, expr: &Expr, scope: &Scope) -> Result<BoundExpr> {
        self.bind_core(expr, scope, &mut None)
    }

    // ---- FROM ----

    fn bind_from(&self, from: &FromClause) -> Result<(LogicalPlan, Scope)> {
        let base_schema = self.catalog.schema_of(&from.base.name)?;
        let mut plan = LogicalPlan::Scan {
            table: from.base.name.clone(),
            schema: base_schema.clone(),
        };
        let mut scope = Scope::from_table(from.base.binding_name(), &base_schema, 0);

        for join in &from.joins {
            let right_schema = self.catalog.schema_of(&join.relation.name)?;
            let right_scope =
                Scope::from_table(join.relation.binding_name(), &right_schema, scope.len());
            let combined = scope.concat(&right_scope);
            let on = self.bind_scalar(&join.on, &combined)?;
            require_predicate("JOIN ON", &on)?;
            let out_schema = plan.schema().concat(&right_schema);
            let right_plan = LogicalPlan::Scan {
                table: join.relation.name.clone(),
                schema: right_schema,
            };
            plan = LogicalPlan::Join {
                left: Box::new(plan),
                right: Box::new(right_plan),
                on,
                join_type: join.join_type,
                schema: out_schema,
            };
            scope = combined;
        }
        Ok((plan, scope))
    }

    // ---- projection (non-aggregate) ----

    fn bind_projection(
        &self,
        items: &[SelectItem],
        scope: &Scope,
    ) -> Result<(Vec<BoundExpr>, Vec<String>, Schema)> {
        let mut exprs = Vec::new();
        let mut names = Vec::new();
        for item in items {
            match item {
                SelectItem::Wildcard => {
                    for (index, name, data_type) in scope.columns() {
                        exprs.push(BoundExpr::Column { index, data_type });
                        names.push(name);
                    }
                }
                SelectItem::QualifiedWildcard(qualifier) => {
                    for (index, name, data_type) in scope.columns_for(qualifier)? {
                        exprs.push(BoundExpr::Column { index, data_type });
                        names.push(name);
                    }
                }
                SelectItem::Expr { expr, alias } => {
                    let bound = self.bind_scalar(expr, scope)?;
                    names.push(alias.clone().unwrap_or_else(|| derive_name(expr)));
                    exprs.push(bound);
                }
            }
        }
        if exprs.is_empty() {
            return Err(Error::binder("SELECT must project at least one column"));
        }
        let schema = schema_from(&names, &exprs);
        Ok((exprs, names, schema))
    }

    // ---- aggregation ----

    fn bind_aggregate(
        &self,
        input: LogicalPlan,
        scope: &Scope,
        select: &SelectStmt,
    ) -> Result<LogicalPlan> {
        // Group expressions are bound in scalar mode against the input row.
        let mut group_expr = Vec::new();
        for g in &select.group_by {
            group_expr.push(self.bind_scalar(g, scope)?);
        }
        let group_count = group_expr.len();
        let group_ast = select.group_by.clone();

        let mut aggregates: Vec<BoundAggregate> = Vec::new();
        let mut proj_exprs = Vec::new();
        let mut proj_names = Vec::new();
        let mut having_bound = None;

        {
            let mut ctx = Some(AggCtx {
                group_exprs: &group_ast,
                aggregates: &mut aggregates,
                group_count,
            });

            for item in &select.projection {
                match item {
                    SelectItem::Wildcard | SelectItem::QualifiedWildcard(_) => {
                        return Err(Error::binder(
                            "'*' cannot be combined with GROUP BY or aggregate functions",
                        ));
                    }
                    SelectItem::Expr { expr, alias } => {
                        let bound = self.bind_core(expr, scope, &mut ctx)?;
                        proj_names.push(alias.clone().unwrap_or_else(|| derive_name(expr)));
                        proj_exprs.push(bound);
                    }
                }
            }

            if let Some(h) = &select.having {
                having_bound = Some(self.bind_core(h, scope, &mut ctx)?);
            }
        }

        // Build the aggregate output schema: group columns then aggregate columns.
        let mut agg_fields = Vec::with_capacity(group_count + aggregates.len());
        for (i, g) in group_ast.iter().enumerate() {
            agg_fields.push(Field::new(derive_name(g), group_expr[i].data_type()));
        }
        for agg in &aggregates {
            agg_fields.push(Field::new(agg.func.name().to_lowercase(), agg.data_type));
        }
        let agg_schema = Schema::new_unchecked(agg_fields);

        let mut plan = LogicalPlan::Aggregate {
            input: Box::new(input),
            group_expr,
            aggregates,
            schema: agg_schema,
        };

        if let Some(h) = having_bound {
            require_predicate("HAVING", &h)?;
            plan = LogicalPlan::Filter {
                input: Box::new(plan),
                predicate: h,
            };
        }

        let proj_schema = schema_from(&proj_names, &proj_exprs);
        Ok(LogicalPlan::Project {
            input: Box::new(plan),
            expressions: proj_exprs,
            aliases: proj_names,
            schema: proj_schema,
        })
    }

    // ---- ORDER BY ----

    /// Build the `Sort` (and, when needed, a stripping projection) for a query.
    ///
    /// Each `ORDER BY` key resolves in this priority: a positional `ORDER BY n`
    /// picks the n-th visible output column; otherwise the key binds against the
    /// output columns; and, for non-aggregate non-distinct queries, a key that
    /// is not an output column binds against the input scope and is carried as a
    /// hidden column that a final projection strips after sorting.
    fn build_sort(
        &self,
        plan: LogicalPlan,
        select: &SelectStmt,
        input_scope: Option<&Scope>,
        visible_count: usize,
    ) -> Result<LogicalPlan> {
        let output_schema = plan.schema().clone();
        let out_scope = Scope::from_output(&output_schema);
        let mut keys = Vec::new();
        let mut hidden_exprs: Vec<BoundExpr> = Vec::new();
        let mut hidden_names: Vec<String> = Vec::new();

        for order in &select.order_by {
            let expr = if let Expr::Literal(crate::types::Value::Integer(n)) = &order.expr {
                let idx = usize::try_from(*n)
                    .ok()
                    .and_then(|n| n.checked_sub(1))
                    .filter(|i| *i < visible_count)
                    .ok_or_else(|| {
                        Error::binder(format!("ORDER BY position {} is out of range", n))
                    })?;
                BoundExpr::Column {
                    index: idx,
                    data_type: output_schema.type_at(idx).unwrap(),
                }
            } else {
                match self.bind_scalar(&order.expr, &out_scope) {
                    Ok(e) => e,
                    Err(out_err) => match input_scope {
                        Some(in_scope) => {
                            let e = self.bind_scalar(&order.expr, in_scope)?;
                            let index = visible_count + hidden_exprs.len();
                            let data_type = e.data_type();
                            hidden_exprs.push(e);
                            hidden_names.push(format!("__order{}", index));
                            BoundExpr::Column { index, data_type }
                        }
                        None => return Err(out_err),
                    },
                }
            };
            keys.push(SortKey {
                expr,
                direction: order.direction,
                nulls_first: order.nulls_first,
            });
        }

        if hidden_exprs.is_empty() {
            return Ok(LogicalPlan::Sort {
                input: Box::new(plan),
                keys,
            });
        }

        // Extend the projection with the hidden sort columns, sort, then strip
        // them back off so the caller sees only the requested columns.
        let extended = extend_project(plan, hidden_exprs, hidden_names)?;
        let sorted = LogicalPlan::Sort {
            input: Box::new(extended),
            keys,
        };
        let strip_exprs: Vec<BoundExpr> = (0..visible_count)
            .map(|i| BoundExpr::Column {
                index: i,
                data_type: output_schema.type_at(i).unwrap(),
            })
            .collect();
        let strip_names: Vec<String> = output_schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();
        Ok(LogicalPlan::Project {
            input: Box::new(sorted),
            expressions: strip_exprs,
            aliases: strip_names,
            schema: output_schema,
        })
    }

    // ---- expression core ----

    fn bind_core(&self, expr: &Expr, scope: &Scope, ctx: &mut Option<AggCtx>) -> Result<BoundExpr> {
        // In aggregate context, a subexpression that matches a GROUP BY key is a
        // reference to that group column in the aggregate output row.
        if let Some(c) = ctx.as_ref() {
            if let Some(i) = c.group_exprs.iter().position(|g| g == expr) {
                let data_type = self.bind_scalar(expr, scope)?.data_type();
                return Ok(BoundExpr::Column {
                    index: i,
                    data_type,
                });
            }
        }

        match expr {
            Expr::Literal(v) => Ok(BoundExpr::Literal(v.clone())),

            Expr::Column(cref) => {
                if ctx.is_some() {
                    return Err(Error::binder(format!(
                        "column '{}' must appear in GROUP BY or be used inside an aggregate function",
                        cref.display_name()
                    )));
                }
                let (index, data_type) = scope.resolve(cref)?;
                Ok(BoundExpr::Column { index, data_type })
            }

            Expr::Function {
                name,
                args,
                distinct,
                star,
            } => {
                if is_aggregate_name(name) {
                    self.bind_aggregate_call(name, args, *distinct, *star, scope, ctx)
                } else {
                    self.bind_scalar_call(name, args, *distinct, *star, scope, ctx)
                }
            }

            Expr::Binary { op, left, right } => {
                let l = self.bind_core(left, scope, ctx)?;
                let r = self.bind_core(right, scope, ctx)?;
                let data_type = binary_result_type(*op, l.data_type(), r.data_type())?;
                Ok(BoundExpr::Binary {
                    op: *op,
                    left: Box::new(l),
                    right: Box::new(r),
                    data_type,
                })
            }

            Expr::Unary { op, expr } => {
                let inner = self.bind_core(expr, scope, ctx)?;
                let data_type = unary_result_type(*op, inner.data_type())?;
                Ok(BoundExpr::Unary {
                    op: *op,
                    expr: Box::new(inner),
                    data_type,
                })
            }

            Expr::Cast { expr, data_type } => {
                let inner = self.bind_core(expr, scope, ctx)?;
                Ok(BoundExpr::Cast {
                    expr: Box::new(inner),
                    data_type: *data_type,
                })
            }

            Expr::IsNull { expr, negated } => {
                let inner = self.bind_core(expr, scope, ctx)?;
                Ok(BoundExpr::IsNull {
                    expr: Box::new(inner),
                    negated: *negated,
                })
            }

            Expr::Between {
                expr,
                low,
                high,
                negated,
            } => {
                let e = self.bind_core(expr, scope, ctx)?;
                let l = self.bind_core(low, scope, ctx)?;
                let h = self.bind_core(high, scope, ctx)?;
                check_comparable("BETWEEN", e.data_type(), l.data_type())?;
                check_comparable("BETWEEN", e.data_type(), h.data_type())?;
                Ok(BoundExpr::Between {
                    expr: Box::new(e),
                    low: Box::new(l),
                    high: Box::new(h),
                    negated: *negated,
                })
            }

            Expr::InList {
                expr,
                list,
                negated,
            } => {
                let e = self.bind_core(expr, scope, ctx)?;
                let mut bound_list = Vec::with_capacity(list.len());
                for item in list {
                    let b = self.bind_core(item, scope, ctx)?;
                    check_comparable("IN", e.data_type(), b.data_type())?;
                    bound_list.push(b);
                }
                Ok(BoundExpr::InList {
                    expr: Box::new(e),
                    list: bound_list,
                    negated: *negated,
                })
            }

            Expr::Like {
                expr,
                pattern,
                negated,
            } => {
                let e = self.bind_core(expr, scope, ctx)?;
                let p = self.bind_core(pattern, scope, ctx)?;
                require_text_or_null("LIKE", e.data_type())?;
                require_text_or_null("LIKE", p.data_type())?;
                Ok(BoundExpr::Like {
                    expr: Box::new(e),
                    pattern: Box::new(p),
                    negated: *negated,
                })
            }

            Expr::Case {
                operand,
                when_then,
                else_result,
            } => self.bind_case(operand, when_then, else_result, scope, ctx),
        }
    }

    fn bind_aggregate_call(
        &self,
        name: &str,
        args: &[Expr],
        distinct: bool,
        star: bool,
        scope: &Scope,
        ctx: &mut Option<AggCtx>,
    ) -> Result<BoundExpr> {
        let func = AggregateFn::from_name(name).unwrap();
        let c = ctx.as_mut().ok_or_else(|| {
            Error::binder(format!(
                "aggregate function {} is not allowed in this context",
                func.name()
            ))
        })?;

        let (arg, arg_type) = if star {
            if !func.allows_star() {
                return Err(Error::binder(format!(
                    "{}(*) is not supported",
                    func.name()
                )));
            }
            if distinct {
                return Err(Error::binder("DISTINCT cannot be combined with '*'"));
            }
            (None, None)
        } else {
            if args.len() != 1 {
                return Err(Error::binder(format!(
                    "{} expects exactly one argument, got {}",
                    func.name(),
                    args.len()
                )));
            }
            // Aggregate arguments are ordinary scalar expressions over the input
            // and may not themselves contain aggregates.
            let bound = self.bind_scalar(&args[0], scope)?;
            let ty = bound.data_type();
            (Some(bound), Some(ty))
        };

        let data_type = func.return_type(arg_type)?;
        let index = c.group_count + c.aggregates.len();
        c.aggregates.push(BoundAggregate {
            func,
            arg,
            distinct,
            data_type,
        });
        Ok(BoundExpr::Column { index, data_type })
    }

    fn bind_scalar_call(
        &self,
        name: &str,
        args: &[Expr],
        distinct: bool,
        star: bool,
        scope: &Scope,
        ctx: &mut Option<AggCtx>,
    ) -> Result<BoundExpr> {
        let func = ScalarFn::from_name(name)
            .ok_or_else(|| Error::binder(format!("unknown function '{}'", name)))?;
        if star {
            return Err(Error::binder(format!(
                "{} does not accept '*'",
                func.name()
            )));
        }
        if distinct {
            return Err(Error::binder(
                "DISTINCT is only valid inside aggregate functions",
            ));
        }
        let mut bound_args = Vec::with_capacity(args.len());
        let mut arg_types = Vec::with_capacity(args.len());
        for a in args {
            let b = self.bind_core(a, scope, ctx)?;
            arg_types.push(b.data_type());
            bound_args.push(b);
        }
        let data_type = func.return_type(&arg_types)?;
        Ok(BoundExpr::Scalar {
            func,
            args: bound_args,
            data_type,
        })
    }

    fn bind_case(
        &self,
        operand: &Option<Box<Expr>>,
        when_then: &[(Expr, Expr)],
        else_result: &Option<Box<Expr>>,
        scope: &Scope,
        ctx: &mut Option<AggCtx>,
    ) -> Result<BoundExpr> {
        let bound_operand = match operand {
            Some(o) => Some(Box::new(self.bind_core(o, scope, ctx)?)),
            None => None,
        };
        let mut bound_when_then = Vec::with_capacity(when_then.len());
        let mut result_type = DataType::Null;
        for (cond, result) in when_then {
            let bound_cond = self.bind_core(cond, scope, ctx)?;
            match &bound_operand {
                Some(op) => {
                    check_comparable("CASE", op.data_type(), bound_cond.data_type())?;
                }
                None => require_predicate("CASE WHEN", &bound_cond)?,
            }
            let bound_result = self.bind_core(result, scope, ctx)?;
            result_type = unify_result("CASE", result_type, bound_result.data_type())?;
            bound_when_then.push((bound_cond, bound_result));
        }
        let bound_else = match else_result {
            Some(e) => {
                let b = self.bind_core(e, scope, ctx)?;
                result_type = unify_result("CASE", result_type, b.data_type())?;
                Some(Box::new(b))
            }
            None => None,
        };
        Ok(BoundExpr::Case {
            operand: bound_operand,
            when_then: bound_when_then,
            else_result: bound_else,
            data_type: result_type,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::statement::Statement;
    use crate::parser::parse_statement;

    fn catalog() -> Catalog {
        let mut c = Catalog::new();
        c.create_table(
            "emp",
            Schema::new(vec![
                Field::new("id", DataType::Integer),
                Field::new("name", DataType::Text),
                Field::new("dept", DataType::Text),
                Field::new("salary", DataType::Integer),
            ])
            .unwrap(),
        )
        .unwrap();
        c
    }

    fn plan(sql: &str) -> Result<LogicalPlan> {
        let c = catalog();
        let stmt = parse_statement(sql).unwrap();
        match stmt {
            Statement::Select(s) => Binder::new(&c).bind_select(&s),
            _ => panic!("expected select"),
        }
    }

    #[test]
    fn binds_projection_and_filter() {
        let p = plan("SELECT name FROM emp WHERE salary > 100").unwrap();
        assert_eq!(p.node_name(), "Project");
        assert_eq!(p.schema().len(), 1);
    }

    #[test]
    fn rejects_unknown_column() {
        assert!(plan("SELECT nope FROM emp").is_err());
    }

    #[test]
    fn rejects_type_mismatch_in_arithmetic() {
        assert!(plan("SELECT name + 1 FROM emp").is_err());
    }

    #[test]
    fn binds_group_by_aggregate() {
        let p = plan("SELECT dept, COUNT(*), SUM(salary) FROM emp GROUP BY dept").unwrap();
        // Project -> Aggregate
        assert_eq!(p.node_name(), "Project");
        let child = p.children()[0];
        assert_eq!(child.node_name(), "Aggregate");
    }

    #[test]
    fn rejects_non_grouped_column_in_aggregate_query() {
        // name is neither grouped nor aggregated
        assert!(plan("SELECT name, COUNT(*) FROM emp GROUP BY dept").is_err());
    }

    #[test]
    fn having_wraps_filter_over_aggregate() {
        let p = plan("SELECT dept FROM emp GROUP BY dept HAVING COUNT(*) > 3").unwrap();
        // Project -> Filter -> Aggregate
        let filter = p.children()[0];
        assert_eq!(filter.node_name(), "Filter");
        assert_eq!(filter.children()[0].node_name(), "Aggregate");
    }

    #[test]
    fn order_by_and_limit_wrap_plan() {
        let p = plan("SELECT name FROM emp ORDER BY name LIMIT 5").unwrap();
        assert_eq!(p.node_name(), "Limit");
        assert_eq!(p.children()[0].node_name(), "Sort");
    }

    #[test]
    fn join_builds_join_node() {
        let mut c = catalog();
        c.create_table(
            "dept",
            Schema::new(vec![
                Field::new("name", DataType::Text),
                Field::new("budget", DataType::Integer),
            ])
            .unwrap(),
        )
        .unwrap();
        let stmt =
            parse_statement("SELECT emp.name, d.budget FROM emp JOIN dept d ON emp.dept = d.name")
                .unwrap();
        let p = match stmt {
            Statement::Select(s) => Binder::new(&c).bind_select(&s).unwrap(),
            _ => panic!(),
        };
        assert_eq!(p.children()[0].node_name(), "Join");
    }
}
