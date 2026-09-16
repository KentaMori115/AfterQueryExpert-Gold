//! Tokens produced by the lexer.

use crate::parser::keyword::Keyword;

/// The lexical category of a token.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    /// An integer literal that fits in `i64`.
    Integer(i64),
    /// A floating-point literal.
    Float(f64),
    /// A single-quoted string literal (already unescaped).
    String(String),
    /// An identifier or keyword. `keyword` is `Some` when the word is reserved.
    Word {
        value: String,
        keyword: Option<Keyword>,
    },

    // Punctuation and operators.
    Comma,
    Dot,
    Semicolon,
    LParen,
    RParen,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    /// The `||` concatenation operator.
    Concat,

    /// End of input.
    Eof,
}

impl TokenKind {
    /// A short human label for diagnostics.
    pub fn describe(&self) -> String {
        match self {
            TokenKind::Integer(_) => "integer literal".to_string(),
            TokenKind::Float(_) => "float literal".to_string(),
            TokenKind::String(_) => "string literal".to_string(),
            TokenKind::Word { value, .. } => format!("`{}`", value),
            TokenKind::Comma => "`,`".to_string(),
            TokenKind::Dot => "`.`".to_string(),
            TokenKind::Semicolon => "`;`".to_string(),
            TokenKind::LParen => "`(`".to_string(),
            TokenKind::RParen => "`)`".to_string(),
            TokenKind::Plus => "`+`".to_string(),
            TokenKind::Minus => "`-`".to_string(),
            TokenKind::Star => "`*`".to_string(),
            TokenKind::Slash => "`/`".to_string(),
            TokenKind::Percent => "`%`".to_string(),
            TokenKind::Eq => "`=`".to_string(),
            TokenKind::NotEq => "`<>`".to_string(),
            TokenKind::Lt => "`<`".to_string(),
            TokenKind::LtEq => "`<=`".to_string(),
            TokenKind::Gt => "`>`".to_string(),
            TokenKind::GtEq => "`>=`".to_string(),
            TokenKind::Concat => "`||`".to_string(),
            TokenKind::Eof => "end of input".to_string(),
        }
    }

    /// If this token is the keyword `kw`.
    pub fn is_keyword(&self, kw: Keyword) -> bool {
        matches!(self, TokenKind::Word { keyword: Some(k), .. } if *k == kw)
    }
}

/// A token plus the byte offset where it started in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub start: usize,
}

impl Token {
    pub fn new(kind: TokenKind, start: usize) -> Token {
        Token { kind, start }
    }
}
