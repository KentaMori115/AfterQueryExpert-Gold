//! The lexer: turns SQL source text into a stream of [`Token`]s.

use crate::error::{Error, Result};
use crate::parser::keyword::Keyword;
use crate::parser::token::{Token, TokenKind};

/// Tokenize `sql` into a vector of tokens terminated by [`TokenKind::Eof`].
///
/// Supports `--` line comments, single-quoted string literals with `''`
/// escaping, integer and decimal (optionally exponentiated) numeric literals,
/// identifiers, and the punctuation/operators of the SQL subset.
pub fn tokenize(sql: &str) -> Result<Vec<Token>> {
    Lexer::new(sql).run()
}

struct Lexer {
    chars: Vec<(usize, char)>,
    pos: usize,
    len: usize,
}

impl Lexer {
    fn new(sql: &str) -> Lexer {
        let chars: Vec<(usize, char)> = sql.char_indices().collect();
        let len = sql.len();
        Lexer { chars, pos: 0, len }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|&(_, c)| c)
    }

    fn peek2(&self) -> Option<char> {
        self.chars.get(self.pos + 1).map(|&(_, c)| c)
    }

    /// Byte offset of the current character (or end-of-input).
    fn offset(&self) -> usize {
        self.chars
            .get(self.pos)
            .map(|&(o, _)| o)
            .unwrap_or(self.len)
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn run(mut self) -> Result<Vec<Token>> {
        let mut tokens = Vec::new();
        loop {
            self.skip_trivia();
            let start = self.offset();
            let c = match self.peek() {
                Some(c) => c,
                None => {
                    tokens.push(Token::new(TokenKind::Eof, start));
                    return Ok(tokens);
                }
            };
            let kind = if c.is_ascii_digit() {
                self.lex_number()?
            } else if c == '_' || c.is_alphabetic() {
                self.lex_word()
            } else if c == '\'' {
                self.lex_string()?
            } else {
                self.lex_operator()?
            };
            tokens.push(Token::new(kind, start));
        }
    }

    /// Skip whitespace and `--` line comments.
    fn skip_trivia(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_whitespace() => {
                    self.bump();
                }
                Some('-') if self.peek2() == Some('-') => {
                    while let Some(c) = self.peek() {
                        self.bump();
                        if c == '\n' {
                            break;
                        }
                    }
                }
                _ => return,
            }
        }
    }

    fn lex_word(&mut self) -> TokenKind {
        let mut value = String::new();
        while let Some(c) = self.peek() {
            if c == '_' || c.is_alphanumeric() {
                value.push(c);
                self.bump();
            } else {
                break;
            }
        }
        let keyword = Keyword::from_upper(&value.to_ascii_uppercase());
        TokenKind::Word { value, keyword }
    }

    fn lex_number(&mut self) -> Result<TokenKind> {
        let start = self.offset();
        let mut text = String::new();
        let mut is_float = false;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                text.push(c);
                self.bump();
            } else if c == '.' && !is_float {
                // Only consume '.' as a decimal point if a digit follows or the
                // fraction is empty; a trailing '.' (e.g. in `t.col`) is handled
                // because words don't start with digits.
                is_float = true;
                text.push(c);
                self.bump();
            } else if (c == 'e' || c == 'E')
                && !text.is_empty()
                && text
                    .chars()
                    .last()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
            {
                is_float = true;
                text.push(c);
                self.bump();
                if let Some(sign) = self.peek() {
                    if sign == '+' || sign == '-' {
                        text.push(sign);
                        self.bump();
                    }
                }
            } else {
                break;
            }
        }
        if is_float {
            text.parse::<f64>()
                .map(TokenKind::Float)
                .map_err(|_| Error::lex(format!("invalid float literal '{}'", text)).at(start))
        } else {
            text.parse::<i64>().map(TokenKind::Integer).map_err(|_| {
                Error::lex(format!("integer literal '{}' out of range", text)).at(start)
            })
        }
    }

    fn lex_string(&mut self) -> Result<TokenKind> {
        let start = self.offset();
        self.bump(); // opening quote
        let mut value = String::new();
        loop {
            match self.bump() {
                None => return Err(Error::lex("unterminated string literal").at(start)),
                Some('\'') => {
                    // A doubled quote is an escaped literal quote.
                    if self.peek() == Some('\'') {
                        self.bump();
                        value.push('\'');
                    } else {
                        return Ok(TokenKind::String(value));
                    }
                }
                Some(c) => value.push(c),
            }
        }
    }

    fn lex_operator(&mut self) -> Result<TokenKind> {
        let start = self.offset();
        let c = self.bump().unwrap();
        let kind = match c {
            ',' => TokenKind::Comma,
            '.' => TokenKind::Dot,
            ';' => TokenKind::Semicolon,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '+' => TokenKind::Plus,
            '-' => TokenKind::Minus,
            '*' => TokenKind::Star,
            '/' => TokenKind::Slash,
            '%' => TokenKind::Percent,
            '=' => TokenKind::Eq,
            '<' => match self.peek() {
                Some('=') => {
                    self.bump();
                    TokenKind::LtEq
                }
                Some('>') => {
                    self.bump();
                    TokenKind::NotEq
                }
                _ => TokenKind::Lt,
            },
            '>' => match self.peek() {
                Some('=') => {
                    self.bump();
                    TokenKind::GtEq
                }
                _ => TokenKind::Gt,
            },
            '!' => match self.peek() {
                Some('=') => {
                    self.bump();
                    TokenKind::NotEq
                }
                _ => return Err(Error::lex("unexpected '!'; did you mean '!='?").at(start)),
            },
            '|' => match self.peek() {
                Some('|') => {
                    self.bump();
                    TokenKind::Concat
                }
                _ => return Err(Error::lex("unexpected '|'; did you mean '||'?").at(start)),
            },
            other => return Err(Error::lex(format!("unexpected character '{}'", other)).at(start)),
        };
        Ok(kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(sql: &str) -> Vec<TokenKind> {
        tokenize(sql).unwrap().into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn lexes_select() {
        let k = kinds("SELECT a, 3 FROM t");
        assert!(matches!(
            k[0],
            TokenKind::Word {
                keyword: Some(Keyword::Select),
                ..
            }
        ));
        assert!(matches!(k[3], TokenKind::Integer(3)));
        assert!(matches!(k.last().unwrap(), TokenKind::Eof));
    }

    #[test]
    fn lexes_operators() {
        assert_eq!(
            kinds("<= >= <> != < > ="),
            vec![
                TokenKind::LtEq,
                TokenKind::GtEq,
                TokenKind::NotEq,
                TokenKind::NotEq,
                TokenKind::Lt,
                TokenKind::Gt,
                TokenKind::Eq,
                TokenKind::Eof,
            ]
        );
    }

    #[test]
    fn lexes_float_and_exponent() {
        assert!(matches!(kinds("3.5")[0], TokenKind::Float(f) if f == 3.5));
        assert!(matches!(kinds("2e3")[0], TokenKind::Float(f) if f == 2000.0));
    }

    #[test]
    fn string_escapes_doubled_quote() {
        match &kinds("'it''s'")[0] {
            TokenKind::String(s) => assert_eq!(s, "it's"),
            other => panic!("expected string, got {:?}", other),
        }
    }

    #[test]
    fn line_comment_is_skipped() {
        let k = kinds("SELECT 1 -- trailing\n, 2");
        assert!(matches!(k[1], TokenKind::Integer(1)));
        assert!(matches!(k[2], TokenKind::Comma));
    }

    #[test]
    fn unterminated_string_errors() {
        let err = tokenize("'abc").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::Lex);
    }

    #[test]
    fn dotted_identifier_keeps_dot_separate() {
        let k = kinds("t.col");
        assert!(matches!(k[0], TokenKind::Word { .. }));
        assert!(matches!(k[1], TokenKind::Dot));
        assert!(matches!(k[2], TokenKind::Word { .. }));
    }
}
