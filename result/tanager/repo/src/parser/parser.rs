//! The parser: a hand-written recursive-descent / Pratt parser that turns a
//! token stream into [`Statement`]s.

use crate::ast::expr::{ColumnRef, Expr};
use crate::ast::operators::{BinaryOp, UnaryOp};
use crate::ast::statement::{
    ColumnDef, CreateTableStmt, DropTableStmt, FromClause, InsertStmt, Join, JoinType, OrderByExpr,
    SelectItem, SelectStmt, SortDirection, Statement, TableFactor,
};
use crate::error::{Error, Result};
use crate::parser::keyword::Keyword;
use crate::parser::lexer::tokenize;
use crate::parser::token::{Token, TokenKind};
use crate::types::{DataType, Value};

/// Parse a single statement, rejecting trailing input.
pub fn parse_statement(sql: &str) -> Result<Statement> {
    let mut stmts = parse_program(sql)?;
    match stmts.len() {
        1 => Ok(stmts.pop().unwrap()),
        0 => Err(Error::parse("empty statement")),
        _ => Err(Error::parse("expected a single statement")),
    }
}

/// Parse a program of one or more `;`-separated statements.
pub fn parse_program(sql: &str) -> Result<Vec<Statement>> {
    let tokens = tokenize(sql)?;
    let mut parser = Parser::new(tokens);
    parser.parse_program()
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Parser {
        Parser { tokens, pos: 0 }
    }

    // ---- token stream helpers ----

    fn peek(&self) -> &TokenKind {
        &self.tokens[self.pos].kind
    }

    fn peek_at(&self, ahead: usize) -> &TokenKind {
        let i = (self.pos + ahead).min(self.tokens.len() - 1);
        &self.tokens[i].kind
    }

    fn position(&self) -> usize {
        self.tokens[self.pos].start
    }

    fn is_eof(&self) -> bool {
        matches!(self.peek(), TokenKind::Eof)
    }

    fn advance(&mut self) -> TokenKind {
        let kind = self.tokens[self.pos].kind.clone();
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        kind
    }

    fn eat(&mut self, kind: &TokenKind) -> bool {
        if self.peek() == kind {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, kind: &TokenKind) -> Result<()> {
        if self.peek() == kind {
            self.advance();
            Ok(())
        } else {
            Err(Error::parse(format!(
                "expected {}, found {}",
                kind.describe(),
                self.peek().describe()
            ))
            .at(self.position()))
        }
    }

    fn at_keyword(&self, kw: Keyword) -> bool {
        self.peek().is_keyword(kw)
    }

    fn eat_keyword(&mut self, kw: Keyword) -> bool {
        if self.at_keyword(kw) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect_keyword(&mut self, kw: Keyword) -> Result<()> {
        if self.eat_keyword(kw) {
            Ok(())
        } else {
            Err(Error::parse(format!(
                "expected keyword `{:?}`, found {}",
                kw,
                self.peek().describe()
            ))
            .at(self.position()))
        }
    }

    /// Consume an identifier (a non-reserved word) and return its text.
    fn expect_identifier(&mut self) -> Result<String> {
        match self.peek().clone() {
            TokenKind::Word {
                value,
                keyword: None,
            } => {
                self.advance();
                Ok(value)
            }
            other => Err(Error::parse(format!(
                "expected an identifier, found {}",
                other.describe()
            ))
            .at(self.position())),
        }
    }

    /// True when the current token is a usable identifier (non-reserved word).
    fn peek_is_identifier(&self) -> bool {
        matches!(self.peek(), TokenKind::Word { keyword: None, .. })
    }

    // ---- program / statements ----

    fn parse_program(&mut self) -> Result<Vec<Statement>> {
        let mut stmts = Vec::new();
        loop {
            while self.eat(&TokenKind::Semicolon) {}
            if self.is_eof() {
                break;
            }
            stmts.push(self.parse_statement()?);
            if !self.is_eof() && !matches!(self.peek(), TokenKind::Semicolon) {
                return Err(Error::parse(format!(
                    "expected `;` or end of input, found {}",
                    self.peek().describe()
                ))
                .at(self.position()));
            }
        }
        Ok(stmts)
    }

    fn parse_statement(&mut self) -> Result<Statement> {
        match self.peek() {
            TokenKind::Word {
                keyword: Some(kw), ..
            } => match kw {
                Keyword::Select => Ok(Statement::Select(self.parse_select()?)),
                Keyword::Insert => Ok(Statement::Insert(self.parse_insert()?)),
                Keyword::Create => Ok(Statement::CreateTable(self.parse_create_table()?)),
                Keyword::Drop => Ok(Statement::DropTable(self.parse_drop_table()?)),
                Keyword::Explain => {
                    self.expect_keyword(Keyword::Explain)?;
                    Ok(Statement::Explain(self.parse_select()?))
                }
                _ => Err(Error::parse(format!(
                    "unexpected keyword `{:?}` at start of statement",
                    kw
                ))
                .at(self.position())),
            },
            other => Err(
                Error::parse(format!("expected a statement, found {}", other.describe()))
                    .at(self.position()),
            ),
        }
    }

    // ---- SELECT ----

    fn parse_select(&mut self) -> Result<SelectStmt> {
        self.expect_keyword(Keyword::Select)?;
        let mut stmt = SelectStmt::empty();
        stmt.distinct = self.eat_keyword(Keyword::Distinct);

        stmt.projection.push(self.parse_select_item()?);
        while self.eat(&TokenKind::Comma) {
            stmt.projection.push(self.parse_select_item()?);
        }

        if self.eat_keyword(Keyword::From) {
            stmt.from = Some(self.parse_from_clause()?);
        }
        if self.eat_keyword(Keyword::Where) {
            stmt.selection = Some(self.parse_expr(0)?);
        }
        if self.eat_keyword(Keyword::Group) {
            self.expect_keyword(Keyword::By)?;
            stmt.group_by.push(self.parse_expr(0)?);
            while self.eat(&TokenKind::Comma) {
                stmt.group_by.push(self.parse_expr(0)?);
            }
        }
        if self.eat_keyword(Keyword::Having) {
            stmt.having = Some(self.parse_expr(0)?);
        }
        if self.eat_keyword(Keyword::Order) {
            self.expect_keyword(Keyword::By)?;
            stmt.order_by.push(self.parse_order_by_item()?);
            while self.eat(&TokenKind::Comma) {
                stmt.order_by.push(self.parse_order_by_item()?);
            }
        }
        if self.eat_keyword(Keyword::Limit) {
            stmt.limit = Some(self.parse_u64("LIMIT")?);
        }
        if self.eat_keyword(Keyword::Offset) {
            stmt.offset = Some(self.parse_u64("OFFSET")?);
        }
        Ok(stmt)
    }

    fn parse_select_item(&mut self) -> Result<SelectItem> {
        if self.eat(&TokenKind::Star) {
            return Ok(SelectItem::Wildcard);
        }
        // `t.*`
        if let TokenKind::Word {
            value,
            keyword: None,
        } = self.peek().clone()
        {
            if matches!(self.peek_at(1), TokenKind::Dot)
                && matches!(self.peek_at(2), TokenKind::Star)
            {
                self.advance(); // word
                self.advance(); // dot
                self.advance(); // star
                return Ok(SelectItem::QualifiedWildcard(value));
            }
        }
        let expr = self.parse_expr(0)?;
        let alias = self.parse_optional_alias()?;
        Ok(SelectItem::Expr { expr, alias })
    }

    /// Parse an optional column/table alias: `AS name` or a bare trailing
    /// identifier.
    fn parse_optional_alias(&mut self) -> Result<Option<String>> {
        // An alias is introduced either by an explicit `AS` or by a bare
        // trailing identifier; both require an identifier to follow.
        if self.eat_keyword(Keyword::As) || self.peek_is_identifier() {
            Ok(Some(self.expect_identifier()?))
        } else {
            Ok(None)
        }
    }

    fn parse_from_clause(&mut self) -> Result<FromClause> {
        let base = self.parse_table_factor()?;
        let mut joins = Vec::new();
        loop {
            let join_type = if self.eat_keyword(Keyword::Inner) {
                self.expect_keyword(Keyword::Join)?;
                JoinType::Inner
            } else if self.eat_keyword(Keyword::Left) {
                self.eat_keyword(Keyword::Join); // optional OUTER omitted; JOIN required
                JoinType::Left
            } else if self.eat_keyword(Keyword::Join) {
                JoinType::Inner
            } else {
                break;
            };
            let relation = self.parse_table_factor()?;
            self.expect_keyword(Keyword::On)?;
            let on = self.parse_expr(0)?;
            joins.push(Join {
                join_type,
                relation,
                on,
            });
        }
        Ok(FromClause { base, joins })
    }

    fn parse_table_factor(&mut self) -> Result<TableFactor> {
        let name = self.expect_identifier()?;
        let alias = self.parse_optional_alias()?;
        Ok(TableFactor { name, alias })
    }

    fn parse_order_by_item(&mut self) -> Result<OrderByExpr> {
        let expr = self.parse_expr(0)?;
        let direction = if self.eat_keyword(Keyword::Desc) {
            SortDirection::Desc
        } else {
            self.eat_keyword(Keyword::Asc);
            SortDirection::Asc
        };
        // Default null ordering follows the common convention: NULLS LAST for
        // ascending, NULLS FIRST for descending. An explicit clause overrides.
        let mut nulls_first = matches!(direction, SortDirection::Desc);
        if self.eat_keyword(Keyword::Nulls) {
            if self.eat_keyword(Keyword::First) {
                nulls_first = true;
            } else if self.eat_keyword(Keyword::Last) {
                nulls_first = false;
            } else {
                return Err(Error::parse("expected FIRST or LAST after NULLS").at(self.position()));
            }
        }
        Ok(OrderByExpr {
            expr,
            direction,
            nulls_first,
        })
    }

    fn parse_u64(&mut self, ctx: &str) -> Result<u64> {
        match self.peek().clone() {
            TokenKind::Integer(i) if i >= 0 => {
                self.advance();
                Ok(i as u64)
            }
            other => Err(Error::parse(format!(
                "{} expects a non-negative integer, found {}",
                ctx,
                other.describe()
            ))
            .at(self.position())),
        }
    }

    // ---- CREATE / DROP / INSERT ----

    fn parse_create_table(&mut self) -> Result<CreateTableStmt> {
        self.expect_keyword(Keyword::Create)?;
        self.expect_keyword(Keyword::Table)?;
        let if_not_exists = if self.eat_keyword(Keyword::If) {
            self.expect_keyword(Keyword::Not)?;
            self.expect_keyword(Keyword::Exists)?;
            true
        } else {
            false
        };
        let name = self.expect_identifier()?;
        self.expect(&TokenKind::LParen)?;
        let mut columns = Vec::new();
        loop {
            let col_name = self.expect_identifier()?;
            let data_type = self.parse_data_type()?;
            let not_null = if self.eat_keyword(Keyword::Not) {
                self.expect_keyword(Keyword::Null)?;
                true
            } else {
                false
            };
            columns.push(ColumnDef {
                name: col_name,
                data_type,
                not_null,
            });
            if !self.eat(&TokenKind::Comma) {
                break;
            }
        }
        self.expect(&TokenKind::RParen)?;
        if columns.is_empty() {
            return Err(Error::parse("CREATE TABLE requires at least one column"));
        }
        Ok(CreateTableStmt {
            name,
            columns,
            if_not_exists,
        })
    }

    fn parse_drop_table(&mut self) -> Result<DropTableStmt> {
        self.expect_keyword(Keyword::Drop)?;
        self.expect_keyword(Keyword::Table)?;
        let if_exists = if self.eat_keyword(Keyword::If) {
            self.expect_keyword(Keyword::Exists)?;
            true
        } else {
            false
        };
        let name = self.expect_identifier()?;
        Ok(DropTableStmt { name, if_exists })
    }

    fn parse_data_type(&mut self) -> Result<DataType> {
        let pos = self.position();
        match self.peek().clone() {
            TokenKind::Word {
                keyword: Some(kw), ..
            } => {
                let dt = match kw {
                    Keyword::Integer => DataType::Integer,
                    Keyword::Float => DataType::Float,
                    Keyword::Text => DataType::Text,
                    Keyword::Boolean => DataType::Boolean,
                    _ => return Err(Error::parse("expected a data type").at(pos)),
                };
                self.advance();
                Ok(dt)
            }
            other => Err(
                Error::parse(format!("expected a data type, found {}", other.describe())).at(pos),
            ),
        }
    }

    fn parse_insert(&mut self) -> Result<InsertStmt> {
        self.expect_keyword(Keyword::Insert)?;
        self.expect_keyword(Keyword::Into)?;
        let table = self.expect_identifier()?;
        let columns = if matches!(self.peek(), TokenKind::LParen) {
            self.advance();
            let mut cols = vec![self.expect_identifier()?];
            while self.eat(&TokenKind::Comma) {
                cols.push(self.expect_identifier()?);
            }
            self.expect(&TokenKind::RParen)?;
            Some(cols)
        } else {
            None
        };
        self.expect_keyword(Keyword::Values)?;
        let mut rows = Vec::new();
        loop {
            self.expect(&TokenKind::LParen)?;
            let mut row = vec![self.parse_expr(0)?];
            while self.eat(&TokenKind::Comma) {
                row.push(self.parse_expr(0)?);
            }
            self.expect(&TokenKind::RParen)?;
            rows.push(row);
            if !self.eat(&TokenKind::Comma) {
                break;
            }
        }
        Ok(InsertStmt {
            table,
            columns,
            rows,
        })
    }

    // ---- expressions (Pratt) ----

    fn parse_expr(&mut self, min_bp: u8) -> Result<Expr> {
        let mut lhs = self.parse_prefix()?;
        loop {
            // Keyword postfix operators live at comparison precedence (4).
            if min_bp <= 4 && self.peek_starts_keyword_postfix() {
                lhs = self.parse_keyword_postfix(lhs)?;
                continue;
            }
            let op = match self.peek_binary_op() {
                Some(op) if op.binding_power() >= min_bp => op,
                _ => break,
            };
            self.advance();
            // Left-associative: parse the RHS at one higher binding power.
            let rhs = self.parse_expr(op.binding_power() + 1)?;
            lhs = Expr::binary(op, lhs, rhs);
        }
        Ok(lhs)
    }

    fn peek_binary_op(&self) -> Option<BinaryOp> {
        Some(match self.peek() {
            TokenKind::Plus => BinaryOp::Add,
            TokenKind::Minus => BinaryOp::Subtract,
            TokenKind::Star => BinaryOp::Multiply,
            TokenKind::Slash => BinaryOp::Divide,
            TokenKind::Percent => BinaryOp::Modulo,
            TokenKind::Eq => BinaryOp::Eq,
            TokenKind::NotEq => BinaryOp::NotEq,
            TokenKind::Lt => BinaryOp::Lt,
            TokenKind::LtEq => BinaryOp::LtEq,
            TokenKind::Gt => BinaryOp::Gt,
            TokenKind::GtEq => BinaryOp::GtEq,
            TokenKind::Concat => BinaryOp::Concat,
            TokenKind::Word {
                keyword: Some(Keyword::And),
                ..
            } => BinaryOp::And,
            TokenKind::Word {
                keyword: Some(Keyword::Or),
                ..
            } => BinaryOp::Or,
            _ => return None,
        })
    }

    /// Whether the next token(s) begin a keyword postfix operator: `IS`,
    /// `BETWEEN`, `IN`, `LIKE`, or a `NOT` immediately before one of the latter.
    fn peek_starts_keyword_postfix(&self) -> bool {
        if matches!(
            self.peek(),
            TokenKind::Word {
                keyword: Some(Keyword::Is | Keyword::Between | Keyword::In | Keyword::Like),
                ..
            }
        ) {
            return true;
        }
        if self.peek().is_keyword(Keyword::Not) {
            return matches!(
                self.peek_at(1),
                TokenKind::Word {
                    keyword: Some(Keyword::Between | Keyword::In | Keyword::Like),
                    ..
                }
            );
        }
        false
    }

    fn parse_keyword_postfix(&mut self, lhs: Expr) -> Result<Expr> {
        // `IS [NOT] NULL`
        if self.eat_keyword(Keyword::Is) {
            let negated = self.eat_keyword(Keyword::Not);
            self.expect_keyword(Keyword::Null)?;
            return Ok(Expr::IsNull {
                expr: Box::new(lhs),
                negated,
            });
        }
        // A leading NOT before BETWEEN / IN / LIKE.
        let negated = self.eat_keyword(Keyword::Not);
        if self.eat_keyword(Keyword::Between) {
            // Operands are parsed above AND so the separating AND is not eaten.
            let low = self.parse_expr(5)?;
            self.expect_keyword(Keyword::And)?;
            let high = self.parse_expr(5)?;
            return Ok(Expr::Between {
                expr: Box::new(lhs),
                low: Box::new(low),
                high: Box::new(high),
                negated,
            });
        }
        if self.eat_keyword(Keyword::In) {
            self.expect(&TokenKind::LParen)?;
            let mut list = vec![self.parse_expr(0)?];
            while self.eat(&TokenKind::Comma) {
                list.push(self.parse_expr(0)?);
            }
            self.expect(&TokenKind::RParen)?;
            return Ok(Expr::InList {
                expr: Box::new(lhs),
                list,
                negated,
            });
        }
        if self.eat_keyword(Keyword::Like) {
            let pattern = self.parse_expr(5)?;
            return Ok(Expr::Like {
                expr: Box::new(lhs),
                pattern: Box::new(pattern),
                negated,
            });
        }
        Err(Error::parse("expected BETWEEN, IN, or LIKE after NOT").at(self.position()))
    }

    fn parse_prefix(&mut self) -> Result<Expr> {
        match self.peek().clone() {
            TokenKind::Minus => {
                self.advance();
                let expr = self.parse_expr(7)?;
                Ok(Expr::unary(UnaryOp::Negate, expr))
            }
            TokenKind::Plus => {
                // Unary plus is a no-op.
                self.advance();
                self.parse_expr(7)
            }
            TokenKind::Word {
                keyword: Some(Keyword::Not),
                ..
            } => {
                self.advance();
                let expr = self.parse_expr(3)?;
                Ok(Expr::unary(UnaryOp::Not, expr))
            }
            _ => self.parse_primary(),
        }
    }

    fn parse_primary(&mut self) -> Result<Expr> {
        let pos = self.position();
        match self.peek().clone() {
            TokenKind::Integer(i) => {
                self.advance();
                Ok(Expr::Literal(Value::Integer(i)))
            }
            TokenKind::Float(f) => {
                self.advance();
                Ok(Expr::Literal(Value::Float(f)))
            }
            TokenKind::String(s) => {
                self.advance();
                Ok(Expr::Literal(Value::Text(s)))
            }
            TokenKind::LParen => {
                self.advance();
                let expr = self.parse_expr(0)?;
                self.expect(&TokenKind::RParen)?;
                Ok(expr)
            }
            TokenKind::Word {
                keyword: Some(kw), ..
            } => match kw {
                Keyword::Null => {
                    self.advance();
                    Ok(Expr::Literal(Value::Null))
                }
                Keyword::True => {
                    self.advance();
                    Ok(Expr::Literal(Value::Boolean(true)))
                }
                Keyword::False => {
                    self.advance();
                    Ok(Expr::Literal(Value::Boolean(false)))
                }
                Keyword::Cast => self.parse_cast(),
                Keyword::Case => self.parse_case(),
                _ => Err(
                    Error::parse(format!("unexpected keyword `{:?}` in expression", kw)).at(pos),
                ),
            },
            TokenKind::Word {
                value,
                keyword: None,
            } => {
                self.advance();
                // Function call?
                if matches!(self.peek(), TokenKind::LParen) {
                    self.parse_function_call(value)
                } else if matches!(self.peek(), TokenKind::Dot) {
                    self.advance();
                    let col = self.expect_identifier()?;
                    Ok(Expr::Column(ColumnRef::qualified(value, col)))
                } else {
                    Ok(Expr::Column(ColumnRef::unqualified(value)))
                }
            }
            other => {
                Err(Error::parse(format!("unexpected {} in expression", other.describe())).at(pos))
            }
        }
    }

    fn parse_function_call(&mut self, name: String) -> Result<Expr> {
        self.expect(&TokenKind::LParen)?;
        // COUNT(*)
        if matches!(self.peek(), TokenKind::Star) {
            self.advance();
            self.expect(&TokenKind::RParen)?;
            return Ok(Expr::Function {
                name,
                args: Vec::new(),
                distinct: false,
                star: true,
            });
        }
        let distinct = self.eat_keyword(Keyword::Distinct);
        let mut args = Vec::new();
        if !matches!(self.peek(), TokenKind::RParen) {
            args.push(self.parse_expr(0)?);
            while self.eat(&TokenKind::Comma) {
                args.push(self.parse_expr(0)?);
            }
        }
        self.expect(&TokenKind::RParen)?;
        Ok(Expr::Function {
            name,
            args,
            distinct,
            star: false,
        })
    }

    fn parse_cast(&mut self) -> Result<Expr> {
        self.expect_keyword(Keyword::Cast)?;
        self.expect(&TokenKind::LParen)?;
        let expr = self.parse_expr(0)?;
        self.expect_keyword(Keyword::As)?;
        let data_type = self.parse_data_type()?;
        self.expect(&TokenKind::RParen)?;
        Ok(Expr::Cast {
            expr: Box::new(expr),
            data_type,
        })
    }

    fn parse_case(&mut self) -> Result<Expr> {
        self.expect_keyword(Keyword::Case)?;
        // Optional simple-CASE operand.
        let operand = if self.at_keyword(Keyword::When) {
            None
        } else {
            Some(Box::new(self.parse_expr(0)?))
        };
        let mut when_then = Vec::new();
        while self.eat_keyword(Keyword::When) {
            let cond = self.parse_expr(0)?;
            self.expect_keyword(Keyword::Then)?;
            let result = self.parse_expr(0)?;
            when_then.push((cond, result));
        }
        if when_then.is_empty() {
            return Err(Error::parse("CASE requires at least one WHEN branch").at(self.position()));
        }
        let else_result = if self.eat_keyword(Keyword::Else) {
            Some(Box::new(self.parse_expr(0)?))
        } else {
            None
        };
        self.expect_keyword(Keyword::End)?;
        Ok(Expr::Case {
            operand,
            when_then,
            else_result,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::statement::Statement;

    fn expr(sql: &str) -> Expr {
        // Parse `SELECT <expr>` and pull the projection expression out.
        match parse_statement(&format!("SELECT {}", sql)).unwrap() {
            Statement::Select(s) => match &s.projection[0] {
                SelectItem::Expr { expr, .. } => expr.clone(),
                _ => panic!("expected expr projection"),
            },
            _ => panic!("expected select"),
        }
    }

    #[test]
    fn precedence_multiplies_before_adds() {
        // 1 + 2 * 3  ==  1 + (2 * 3)
        let e = expr("1 + 2 * 3");
        match e {
            Expr::Binary {
                op: BinaryOp::Add,
                right,
                ..
            } => assert!(matches!(
                *right,
                Expr::Binary {
                    op: BinaryOp::Multiply,
                    ..
                }
            )),
            other => panic!("unexpected {:?}", other),
        }
    }

    #[test]
    fn comparison_below_arithmetic() {
        // a + 1 = b  ==  (a + 1) = b
        let e = expr("a + 1 = b");
        assert!(matches!(
            e,
            Expr::Binary {
                op: BinaryOp::Eq,
                ..
            }
        ));
    }

    #[test]
    fn and_below_or_above_comparison() {
        // a = 1 AND b = 2 OR c = 3 == ((a=1) AND (b=2)) OR (c=3)
        let e = expr("a = 1 AND b = 2 OR c = 3");
        assert!(matches!(
            e,
            Expr::Binary {
                op: BinaryOp::Or,
                ..
            }
        ));
    }

    #[test]
    fn parses_between_without_eating_outer_and() {
        // x BETWEEN 1 AND 10 AND y  ==  (x BETWEEN 1 AND 10) AND y
        let e = expr("x BETWEEN 1 AND 10 AND y");
        assert!(matches!(
            e,
            Expr::Binary {
                op: BinaryOp::And,
                ..
            }
        ));
    }

    #[test]
    fn parses_full_select() {
        let s = parse_statement(
            "SELECT a, b AS bee, t.* FROM t JOIN u ON t.id = u.id \
             WHERE a > 1 GROUP BY a HAVING COUNT(*) > 2 ORDER BY a DESC LIMIT 5 OFFSET 1",
        )
        .unwrap();
        match s {
            Statement::Select(s) => {
                assert_eq!(s.projection.len(), 3);
                assert_eq!(s.from.as_ref().unwrap().joins.len(), 1);
                assert!(s.selection.is_some());
                assert_eq!(s.group_by.len(), 1);
                assert!(s.having.is_some());
                assert_eq!(s.order_by.len(), 1);
                assert_eq!(s.limit, Some(5));
                assert_eq!(s.offset, Some(1));
            }
            _ => panic!("expected select"),
        }
    }

    #[test]
    fn parses_create_and_insert() {
        let c = parse_statement("CREATE TABLE t (id INTEGER NOT NULL, name TEXT)").unwrap();
        assert!(matches!(c, Statement::CreateTable(_)));
        let i = parse_statement("INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b')").unwrap();
        match i {
            Statement::Insert(i) => {
                assert_eq!(i.rows.len(), 2);
                assert_eq!(i.columns.as_ref().unwrap().len(), 2);
            }
            _ => panic!("expected insert"),
        }
    }

    #[test]
    fn rejects_trailing_tokens() {
        assert!(parse_statement("SELECT 1 2").is_err());
    }

    #[test]
    fn case_and_cast_parse() {
        let _ = expr("CASE WHEN a > 1 THEN 'big' ELSE 'small' END");
        let _ = expr("CAST(a AS FLOAT)");
        let _ = expr("a IS NOT NULL");
        let _ = expr("a NOT IN (1, 2, 3)");
        let _ = expr("name LIKE 'a%'");
    }
}
