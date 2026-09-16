//! The expression AST produced by the parser.

use crate::ast::operators::{BinaryOp, UnaryOp};
use crate::types::{DataType, Value};

/// A column reference, optionally qualified by a table name/alias.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnRef {
    /// Qualifier (`t` in `t.col`), if written.
    pub qualifier: Option<String>,
    /// The bare column name.
    pub name: String,
}

impl ColumnRef {
    pub fn unqualified(name: impl Into<String>) -> ColumnRef {
        ColumnRef {
            qualifier: None,
            name: name.into(),
        }
    }

    pub fn qualified(qualifier: impl Into<String>, name: impl Into<String>) -> ColumnRef {
        ColumnRef {
            qualifier: Some(qualifier.into()),
            name: name.into(),
        }
    }

    /// The way this reference was spelled in the query, for error messages.
    pub fn display_name(&self) -> String {
        match &self.qualifier {
            Some(q) => format!("{}.{}", q, self.name),
            None => self.name.clone(),
        }
    }
}

/// An expression node.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// A literal value (`1`, `'x'`, `TRUE`, `NULL`).
    Literal(Value),
    /// A column reference.
    Column(ColumnRef),
    /// A binary operation.
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    /// A prefix unary operation.
    Unary { op: UnaryOp, expr: Box<Expr> },
    /// A scalar or aggregate function call, e.g. `SUM(x)` or `COALESCE(a, b)`.
    Function {
        name: String,
        args: Vec<Expr>,
        /// `true` for `COUNT(DISTINCT x)` and friends.
        distinct: bool,
        /// `true` for the special `COUNT(*)` form.
        star: bool,
    },
    /// `CAST(expr AS type)`.
    Cast {
        expr: Box<Expr>,
        data_type: DataType,
    },
    /// `expr IS [NOT] NULL`.
    IsNull { expr: Box<Expr>, negated: bool },
    /// `expr [NOT] BETWEEN low AND high`.
    Between {
        expr: Box<Expr>,
        low: Box<Expr>,
        high: Box<Expr>,
        negated: bool,
    },
    /// `expr [NOT] IN (list...)`.
    InList {
        expr: Box<Expr>,
        list: Vec<Expr>,
        negated: bool,
    },
    /// `expr [NOT] LIKE pattern` — `%` matches any run, `_` matches one char.
    Like {
        expr: Box<Expr>,
        pattern: Box<Expr>,
        negated: bool,
    },
    /// `CASE [operand] WHEN cond THEN result ... [ELSE default] END`.
    Case {
        /// The simple-CASE operand, if any (`CASE x WHEN 1 ...`).
        operand: Option<Box<Expr>>,
        /// `(condition, result)` pairs.
        when_then: Vec<(Expr, Expr)>,
        /// The `ELSE` result, if any.
        else_result: Option<Box<Expr>>,
    },
}

impl Expr {
    /// Convenience constructor for a binary expression.
    pub fn binary(op: BinaryOp, left: Expr, right: Expr) -> Expr {
        Expr::Binary {
            op,
            left: Box::new(left),
            right: Box::new(right),
        }
    }

    /// Convenience constructor for a unary expression.
    pub fn unary(op: UnaryOp, expr: Expr) -> Expr {
        Expr::Unary {
            op,
            expr: Box::new(expr),
        }
    }

    /// An unqualified column reference.
    pub fn column(name: impl Into<String>) -> Expr {
        Expr::Column(ColumnRef::unqualified(name))
    }

    /// An integer literal.
    pub fn int(v: i64) -> Expr {
        Expr::Literal(Value::Integer(v))
    }

    /// Whether this expression syntactically contains an aggregate function
    /// call (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`). Used by the binder to route
    /// projections into the aggregate operator. The set of names treated as
    /// aggregates is owned by [`is_aggregate_name`].
    pub fn contains_aggregate(&self) -> bool {
        match self {
            Expr::Function { name, star, .. } => {
                if is_aggregate_name(name) {
                    return true;
                }
                // Even a scalar function may wrap an aggregate in its args.
                let _ = star;
                self.any_child(|c| c.contains_aggregate())
            }
            _ => self.any_child(|c| c.contains_aggregate()),
        }
    }

    /// Apply `f` to each immediate child expression, returning `true` if any
    /// call does. Keeps traversal logic in one place.
    pub fn any_child(&self, mut f: impl FnMut(&Expr) -> bool) -> bool {
        let mut hit = false;
        self.for_each_child(&mut |c| {
            if f(c) {
                hit = true;
            }
        });
        hit
    }

    /// Invoke `f` on each immediate child expression.
    pub fn for_each_child(&self, f: &mut dyn FnMut(&Expr)) {
        match self {
            Expr::Literal(_) | Expr::Column(_) => {}
            Expr::Binary { left, right, .. } => {
                f(left);
                f(right);
            }
            Expr::Unary { expr, .. } | Expr::Cast { expr, .. } | Expr::IsNull { expr, .. } => {
                f(expr)
            }
            Expr::Function { args, .. } => {
                for a in args {
                    f(a);
                }
            }
            Expr::Between {
                expr, low, high, ..
            } => {
                f(expr);
                f(low);
                f(high);
            }
            Expr::InList { expr, list, .. } => {
                f(expr);
                for e in list {
                    f(e);
                }
            }
            Expr::Like { expr, pattern, .. } => {
                f(expr);
                f(pattern);
            }
            Expr::Case {
                operand,
                when_then,
                else_result,
            } => {
                if let Some(o) = operand {
                    f(o);
                }
                for (w, t) in when_then {
                    f(w);
                    f(t);
                }
                if let Some(e) = else_result {
                    f(e);
                }
            }
        }
    }
}

/// The set of function names the engine treats as aggregates.
pub fn is_aggregate_name(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "COUNT"
            | "SUM"
            | "AVG"
            | "MIN"
            | "MAX"
            | "GROUP_CONCAT"
            | "STRING_AGG"
            | "VAR_POP"
            | "VARIANCE"
            | "STDDEV_POP"
            | "STDDEV"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_nested_aggregate() {
        // 1 + SUM(x)
        let e = Expr::binary(
            BinaryOp::Add,
            Expr::int(1),
            Expr::Function {
                name: "SUM".into(),
                args: vec![Expr::column("x")],
                distinct: false,
                star: false,
            },
        );
        assert!(e.contains_aggregate());
    }

    #[test]
    fn scalar_expr_has_no_aggregate() {
        let e = Expr::binary(BinaryOp::Add, Expr::column("a"), Expr::int(2));
        assert!(!e.contains_aggregate());
    }

    #[test]
    fn column_ref_display() {
        assert_eq!(ColumnRef::qualified("t", "c").display_name(), "t.c");
        assert_eq!(ColumnRef::unqualified("c").display_name(), "c");
    }
}
