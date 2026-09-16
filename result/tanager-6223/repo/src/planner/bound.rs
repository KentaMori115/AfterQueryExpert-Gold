//! Bound expressions: the type-checked, index-resolved form of [`crate::ast::Expr`].
//!
//! After binding, every column reference is a positional [`BoundExpr::Column`]
//! into the operator's input row, every node carries its resolved
//! [`DataType`], and aggregate calls have been lifted out into a separate
//! [`BoundAggregate`] list (referenced positionally as columns of the aggregate
//! operator's output).

use crate::ast::operators::{BinaryOp, UnaryOp};
use crate::error::Result;
use crate::functions::{AggregateFn, ScalarFn};
use crate::types::{DataType, Value};

/// A type-checked expression over a positional input row.
#[derive(Debug, Clone, PartialEq)]
pub enum BoundExpr {
    Literal(Value),
    /// A column of the input row, by position.
    Column {
        index: usize,
        data_type: DataType,
    },
    Binary {
        op: BinaryOp,
        left: Box<BoundExpr>,
        right: Box<BoundExpr>,
        data_type: DataType,
    },
    Unary {
        op: UnaryOp,
        expr: Box<BoundExpr>,
        data_type: DataType,
    },
    Cast {
        expr: Box<BoundExpr>,
        data_type: DataType,
    },
    IsNull {
        expr: Box<BoundExpr>,
        negated: bool,
    },
    Between {
        expr: Box<BoundExpr>,
        low: Box<BoundExpr>,
        high: Box<BoundExpr>,
        negated: bool,
    },
    InList {
        expr: Box<BoundExpr>,
        list: Vec<BoundExpr>,
        negated: bool,
    },
    Like {
        expr: Box<BoundExpr>,
        pattern: Box<BoundExpr>,
        negated: bool,
    },
    Case {
        operand: Option<Box<BoundExpr>>,
        when_then: Vec<(BoundExpr, BoundExpr)>,
        else_result: Option<Box<BoundExpr>>,
        data_type: DataType,
    },
    Scalar {
        func: ScalarFn,
        args: Vec<BoundExpr>,
        data_type: DataType,
    },
}

impl BoundExpr {
    /// The resolved type of this expression.
    pub fn data_type(&self) -> DataType {
        match self {
            BoundExpr::Literal(v) => v.data_type(),
            BoundExpr::Column { data_type, .. } => *data_type,
            BoundExpr::Binary { data_type, .. } => *data_type,
            BoundExpr::Unary { data_type, .. } => *data_type,
            BoundExpr::Cast { data_type, .. } => *data_type,
            BoundExpr::IsNull { .. } => DataType::Boolean,
            BoundExpr::Between { .. } => DataType::Boolean,
            BoundExpr::InList { .. } => DataType::Boolean,
            BoundExpr::Like { .. } => DataType::Boolean,
            BoundExpr::Case { data_type, .. } => *data_type,
            BoundExpr::Scalar { data_type, .. } => *data_type,
        }
    }

    /// Whether this expression is a constant (contains no column references).
    /// Used by the optimizer's constant-folding rule.
    pub fn is_constant(&self) -> bool {
        match self {
            BoundExpr::Column { .. } => false,
            BoundExpr::Literal(_) => true,
            _ => {
                let mut constant = true;
                self.for_each_child(&mut |c| {
                    if !c.is_constant() {
                        constant = false;
                    }
                });
                constant
            }
        }
    }

    /// Apply `f` to each immediate child.
    pub fn for_each_child(&self, f: &mut dyn FnMut(&BoundExpr)) {
        match self {
            BoundExpr::Literal(_) | BoundExpr::Column { .. } => {}
            BoundExpr::Binary { left, right, .. } => {
                f(left);
                f(right);
            }
            BoundExpr::Unary { expr, .. }
            | BoundExpr::Cast { expr, .. }
            | BoundExpr::IsNull { expr, .. } => f(expr),
            BoundExpr::Between {
                expr, low, high, ..
            } => {
                f(expr);
                f(low);
                f(high);
            }
            BoundExpr::InList { expr, list, .. } => {
                f(expr);
                for e in list {
                    f(e);
                }
            }
            BoundExpr::Like { expr, pattern, .. } => {
                f(expr);
                f(pattern);
            }
            BoundExpr::Case {
                operand,
                when_then,
                else_result,
                ..
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
            BoundExpr::Scalar { args, .. } => {
                for a in args {
                    f(a);
                }
            }
        }
    }

    /// The maximum column index referenced by this expression, plus one — i.e.
    /// the minimum input width the expression requires. Returns 0 for a
    /// constant expression.
    pub fn required_width(&self) -> usize {
        let mut max = 0;
        self.walk(&mut |e| {
            if let BoundExpr::Column { index, .. } = e {
                max = max.max(index + 1);
            }
        });
        max
    }

    /// Pre-order walk over this expression and all descendants.
    pub fn walk(&self, f: &mut dyn FnMut(&BoundExpr)) {
        f(self);
        self.for_each_child(&mut |c| c.walk(f));
    }

    /// Rebuild this node, applying `f` to each immediate child (by value).
    ///
    /// This is the workhorse for optimizer rewrites: combine it with recursion
    /// to transform an entire expression tree bottom-up without hand-writing
    /// the reconstruction at every call site.
    pub fn map_children(
        self,
        f: &mut dyn FnMut(BoundExpr) -> Result<BoundExpr>,
    ) -> Result<BoundExpr> {
        let mapped = match self {
            BoundExpr::Literal(_) | BoundExpr::Column { .. } => self,
            BoundExpr::Binary {
                op,
                left,
                right,
                data_type,
            } => BoundExpr::Binary {
                op,
                left: Box::new(f(*left)?),
                right: Box::new(f(*right)?),
                data_type,
            },
            BoundExpr::Unary {
                op,
                expr,
                data_type,
            } => BoundExpr::Unary {
                op,
                expr: Box::new(f(*expr)?),
                data_type,
            },
            BoundExpr::Cast { expr, data_type } => BoundExpr::Cast {
                expr: Box::new(f(*expr)?),
                data_type,
            },
            BoundExpr::IsNull { expr, negated } => BoundExpr::IsNull {
                expr: Box::new(f(*expr)?),
                negated,
            },
            BoundExpr::Between {
                expr,
                low,
                high,
                negated,
            } => BoundExpr::Between {
                expr: Box::new(f(*expr)?),
                low: Box::new(f(*low)?),
                high: Box::new(f(*high)?),
                negated,
            },
            BoundExpr::InList {
                expr,
                list,
                negated,
            } => {
                let expr = Box::new(f(*expr)?);
                let mut mapped = Vec::with_capacity(list.len());
                for e in list {
                    mapped.push(f(e)?);
                }
                BoundExpr::InList {
                    expr,
                    list: mapped,
                    negated,
                }
            }
            BoundExpr::Like {
                expr,
                pattern,
                negated,
            } => BoundExpr::Like {
                expr: Box::new(f(*expr)?),
                pattern: Box::new(f(*pattern)?),
                negated,
            },
            BoundExpr::Case {
                operand,
                when_then,
                else_result,
                data_type,
            } => {
                let operand = match operand {
                    Some(o) => Some(Box::new(f(*o)?)),
                    None => None,
                };
                let mut mapped = Vec::with_capacity(when_then.len());
                for (w, t) in when_then {
                    mapped.push((f(w)?, f(t)?));
                }
                let else_result = match else_result {
                    Some(e) => Some(Box::new(f(*e)?)),
                    None => None,
                };
                BoundExpr::Case {
                    operand,
                    when_then: mapped,
                    else_result,
                    data_type,
                }
            }
            BoundExpr::Scalar {
                func,
                args,
                data_type,
            } => {
                let mut mapped = Vec::with_capacity(args.len());
                for a in args {
                    mapped.push(f(a)?);
                }
                BoundExpr::Scalar {
                    func,
                    args: mapped,
                    data_type,
                }
            }
        };
        Ok(mapped)
    }
}

/// A bound aggregate call: `func([DISTINCT] arg)` with a resolved result type.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundAggregate {
    pub func: AggregateFn,
    /// `None` for the `COUNT(*)` star form.
    pub arg: Option<BoundExpr>,
    pub distinct: bool,
    pub data_type: DataType,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_detection() {
        let c = BoundExpr::Binary {
            op: BinaryOp::Add,
            left: Box::new(BoundExpr::Literal(Value::Integer(1))),
            right: Box::new(BoundExpr::Literal(Value::Integer(2))),
            data_type: DataType::Integer,
        };
        assert!(c.is_constant());

        let col = BoundExpr::Column {
            index: 0,
            data_type: DataType::Integer,
        };
        assert!(!col.is_constant());
    }

    #[test]
    fn required_width_tracks_max_index() {
        let e = BoundExpr::Binary {
            op: BinaryOp::Add,
            left: Box::new(BoundExpr::Column {
                index: 0,
                data_type: DataType::Integer,
            }),
            right: Box::new(BoundExpr::Column {
                index: 3,
                data_type: DataType::Integer,
            }),
            data_type: DataType::Integer,
        };
        assert_eq!(e.required_width(), 4);
    }
}
