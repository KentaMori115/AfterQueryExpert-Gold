//! Operator definitions shared by the AST, binder, and evaluator.

use std::fmt;

/// A binary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Modulo,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    And,
    Or,
    /// String concatenation (`||`).
    Concat,
}

impl BinaryOp {
    /// The SQL surface symbol/keyword for the operator.
    pub fn symbol(self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Subtract => "-",
            BinaryOp::Multiply => "*",
            BinaryOp::Divide => "/",
            BinaryOp::Modulo => "%",
            BinaryOp::Eq => "=",
            BinaryOp::NotEq => "<>",
            BinaryOp::Lt => "<",
            BinaryOp::LtEq => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::GtEq => ">=",
            BinaryOp::And => "AND",
            BinaryOp::Or => "OR",
            BinaryOp::Concat => "||",
        }
    }

    /// Whether this operator is string concatenation.
    pub fn is_concat(self) -> bool {
        matches!(self, BinaryOp::Concat)
    }

    /// Whether the operator is arithmetic (`+ - * / %`).
    pub fn is_arithmetic(self) -> bool {
        matches!(
            self,
            BinaryOp::Add
                | BinaryOp::Subtract
                | BinaryOp::Multiply
                | BinaryOp::Divide
                | BinaryOp::Modulo
        )
    }

    /// Whether the operator is a comparison (`= <> < <= > >=`).
    pub fn is_comparison(self) -> bool {
        matches!(
            self,
            BinaryOp::Eq
                | BinaryOp::NotEq
                | BinaryOp::Lt
                | BinaryOp::LtEq
                | BinaryOp::Gt
                | BinaryOp::GtEq
        )
    }

    /// Whether the operator is a boolean connective (`AND`, `OR`).
    pub fn is_logical(self) -> bool {
        matches!(self, BinaryOp::And | BinaryOp::Or)
    }

    /// Left binding power for Pratt parsing. Higher binds tighter.
    pub fn binding_power(self) -> u8 {
        match self {
            BinaryOp::Or => 1,
            BinaryOp::And => 2,
            BinaryOp::Eq
            | BinaryOp::NotEq
            | BinaryOp::Lt
            | BinaryOp::LtEq
            | BinaryOp::Gt
            | BinaryOp::GtEq => 4,
            BinaryOp::Add | BinaryOp::Subtract | BinaryOp::Concat => 5,
            BinaryOp::Multiply | BinaryOp::Divide | BinaryOp::Modulo => 6,
        }
    }
}

impl fmt::Display for BinaryOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.symbol())
    }
}

/// A prefix unary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnaryOp {
    /// Arithmetic negation (`-x`).
    Negate,
    /// Logical negation (`NOT x`).
    Not,
}

impl UnaryOp {
    pub fn symbol(self) -> &'static str {
        match self {
            UnaryOp::Negate => "-",
            UnaryOp::Not => "NOT",
        }
    }
}

impl fmt::Display for UnaryOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.symbol())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precedence_orders_correctly() {
        assert!(BinaryOp::Multiply.binding_power() > BinaryOp::Add.binding_power());
        assert!(BinaryOp::Add.binding_power() > BinaryOp::Eq.binding_power());
        assert!(BinaryOp::Eq.binding_power() > BinaryOp::And.binding_power());
        assert!(BinaryOp::And.binding_power() > BinaryOp::Or.binding_power());
    }

    #[test]
    fn classification() {
        assert!(BinaryOp::Add.is_arithmetic());
        assert!(BinaryOp::Lt.is_comparison());
        assert!(BinaryOp::Or.is_logical());
        assert!(!BinaryOp::Or.is_arithmetic());
    }
}
