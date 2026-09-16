//! The parsing front end: lexer, tokens, keywords, and the Pratt parser.

pub mod keyword;
pub mod lexer;
#[allow(clippy::module_inception)]
pub mod parser;
pub mod token;

pub use keyword::Keyword;
pub use lexer::tokenize;
pub use parser::{parse_program, parse_statement};
pub use token::{Token, TokenKind};
