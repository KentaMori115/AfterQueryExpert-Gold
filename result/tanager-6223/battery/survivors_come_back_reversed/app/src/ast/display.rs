//! `Display` implementations that render AST expressions back to SQL-like text.
//!
//! This is primarily a debugging and diagnostics aid: it lets an [`Expr`] be
//! printed in a form close to how it was written, without reconstructing the
//! exact original whitespace.

use std::fmt;

use crate::ast::expr::Expr;

impl fmt::Display for Expr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expr::Literal(v) => write!(f, "{}", v),
            Expr::Column(c) => f.write_str(&c.display_name()),
            Expr::Binary { op, left, right } => write!(f, "({} {} {})", left, op, right),
            Expr::Unary { op, expr } => write!(f, "{}{}", op, expr),
            Expr::Cast { expr, data_type } => write!(f, "CAST({} AS {})", expr, data_type),
            Expr::IsNull { expr, negated } => {
                let kw = if *negated { "IS NOT NULL" } else { "IS NULL" };
                write!(f, "({} {})", expr, kw)
            }
            Expr::Between {
                expr,
                low,
                high,
                negated,
            } => {
                let kw = if *negated { "NOT BETWEEN" } else { "BETWEEN" };
                write!(f, "({} {} {} AND {})", expr, kw, low, high)
            }
            Expr::InList {
                expr,
                list,
                negated,
            } => {
                let kw = if *negated { "NOT IN" } else { "IN" };
                write!(f, "({} {} (", expr, kw)?;
                write_comma_separated(f, list)?;
                f.write_str("))")
            }
            Expr::Like {
                expr,
                pattern,
                negated,
            } => {
                let kw = if *negated { "NOT LIKE" } else { "LIKE" };
                write!(f, "({} {} {})", expr, kw, pattern)
            }
            Expr::Function {
                name,
                args,
                distinct,
                star,
            } => {
                write!(f, "{}(", name)?;
                if *star {
                    f.write_str("*")?;
                } else {
                    if *distinct {
                        f.write_str("DISTINCT ")?;
                    }
                    write_comma_separated(f, args)?;
                }
                f.write_str(")")
            }
            Expr::Case {
                operand,
                when_then,
                else_result,
            } => {
                f.write_str("CASE")?;
                if let Some(o) = operand {
                    write!(f, " {}", o)?;
                }
                for (w, t) in when_then {
                    write!(f, " WHEN {} THEN {}", w, t)?;
                }
                if let Some(e) = else_result {
                    write!(f, " ELSE {}", e)?;
                }
                f.write_str(" END")
            }
        }
    }
}

fn write_comma_separated(f: &mut fmt::Formatter<'_>, items: &[Expr]) -> fmt::Result {
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            f.write_str(", ")?;
        }
        write!(f, "{}", item)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::ast::statement::{SelectItem, Statement};
    use crate::parser::parse_statement;

    fn render(sql: &str) -> String {
        match parse_statement(&format!("SELECT {}", sql)).unwrap() {
            Statement::Select(s) => match &s.projection[0] {
                SelectItem::Expr { expr, .. } => format!("{}", expr),
                _ => panic!("expected expr"),
            },
            _ => panic!("expected select"),
        }
    }

    #[test]
    fn renders_arithmetic_with_precedence_parens() {
        assert_eq!(render("1 + 2 * 3"), "(1 + (2 * 3))");
    }

    #[test]
    fn renders_function_calls() {
        assert_eq!(render("COUNT(*)"), "COUNT(*)");
        assert_eq!(render("COALESCE(a, 0)"), "COALESCE(a, 0)");
        assert_eq!(render("SUM(DISTINCT x)"), "SUM(DISTINCT x)");
    }

    #[test]
    fn renders_predicates() {
        assert_eq!(render("a IS NOT NULL"), "(a IS NOT NULL)");
        assert_eq!(render("a NOT IN (1, 2)"), "(a NOT IN (1, 2))");
        assert_eq!(render("name LIKE 'a%'"), "(name LIKE a%)");
    }

    #[test]
    fn renders_case_and_cast() {
        assert_eq!(
            render("CASE WHEN a THEN 1 ELSE 2 END"),
            "CASE WHEN a THEN 1 ELSE 2 END"
        );
        assert_eq!(render("CAST(a AS FLOAT)"), "CAST(a AS FLOAT)");
    }
}
