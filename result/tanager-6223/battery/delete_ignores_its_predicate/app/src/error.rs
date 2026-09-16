//! Error types for the tanager query engine.
//!
//! Every fallible operation in the engine returns [`Result<T>`], which is a
//! type alias for `std::result::Result<T, Error>`. Errors carry a category so
//! callers (and tests) can distinguish, for example, a parse failure from a
//! type error without matching on human-readable strings.

use std::fmt;

/// The category of an [`Error`].
///
/// Categories are deliberately coarse: they describe *which stage* of query
/// processing rejected the input, which is the level of detail callers need to
/// route errors. The attached message carries the specifics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// The lexer could not tokenize the input.
    Lex,
    /// The parser rejected an otherwise well-tokenized statement.
    Parse,
    /// Name resolution failed: an unknown table, column, or function.
    Binder,
    /// A type rule was violated (incompatible operands, bad cast, ...).
    Type,
    /// A value-level failure surfaced during execution (division by zero, ...).
    Execution,
    /// A catalog mutation was rejected (duplicate table, missing table, ...).
    Catalog,
    /// The caller misused the public API (e.g. wrong column count on insert).
    Api,
    /// A feature was recognized but is intentionally not implemented.
    Unsupported,
}

impl ErrorKind {
    /// A short, stable, lower-case tag for the category. Useful in tests and
    /// structured logging; never changes for a given variant.
    pub fn tag(self) -> &'static str {
        match self {
            ErrorKind::Lex => "lex",
            ErrorKind::Parse => "parse",
            ErrorKind::Binder => "binder",
            ErrorKind::Type => "type",
            ErrorKind::Execution => "execution",
            ErrorKind::Catalog => "catalog",
            ErrorKind::Api => "api",
            ErrorKind::Unsupported => "unsupported",
        }
    }
}

impl fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.tag())
    }
}

/// An engine error: a [`ErrorKind`] plus a human-readable message and an
/// optional source position (byte offset into the original SQL text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    kind: ErrorKind,
    message: String,
    position: Option<usize>,
}

impl Error {
    /// Build an error of `kind` with `message`.
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Error {
            kind,
            message: message.into(),
            position: None,
        }
    }

    /// Attach a source byte offset, returning the updated error.
    pub fn at(mut self, position: usize) -> Self {
        self.position = Some(position);
        self
    }

    /// The category of this error.
    pub fn kind(&self) -> ErrorKind {
        self.kind
    }

    /// The human-readable message (without the category prefix).
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The source byte offset, if one was attached.
    pub fn position(&self) -> Option<usize> {
        self.position
    }

    // ------------------------------------------------------------------
    // Convenience constructors, one per category. These keep call sites
    // terse and consistent across the codebase.
    // ------------------------------------------------------------------

    pub fn lex(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Lex, message)
    }
    pub fn parse(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Parse, message)
    }
    pub fn binder(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Binder, message)
    }
    pub fn type_error(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Type, message)
    }
    pub fn execution(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Execution, message)
    }
    pub fn catalog(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Catalog, message)
    }
    pub fn api(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Api, message)
    }
    pub fn unsupported(message: impl Into<String>) -> Self {
        Error::new(ErrorKind::Unsupported, message)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.position {
            Some(pos) => write!(f, "{} error at byte {}: {}", self.kind, pos, self.message),
            None => write!(f, "{} error: {}", self.kind, self.message),
        }
    }
}

impl std::error::Error for Error {}

/// The crate-wide result type.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_stable() {
        assert_eq!(ErrorKind::Parse.tag(), "parse");
        assert_eq!(ErrorKind::Type.tag(), "type");
        assert_eq!(ErrorKind::Execution.tag(), "execution");
    }

    #[test]
    fn display_includes_position_when_present() {
        let e = Error::parse("unexpected token").at(12);
        assert_eq!(e.to_string(), "parse error at byte 12: unexpected token");
        assert_eq!(e.position(), Some(12));
    }

    #[test]
    fn display_omits_position_when_absent() {
        let e = Error::type_error("cannot add TEXT and INT");
        assert_eq!(e.to_string(), "type error: cannot add TEXT and INT");
        assert_eq!(e.position(), None);
    }

    #[test]
    fn constructors_set_kind() {
        assert_eq!(Error::binder("x").kind(), ErrorKind::Binder);
        assert_eq!(Error::catalog("x").kind(), ErrorKind::Catalog);
        assert_eq!(Error::api("x").kind(), ErrorKind::Api);
    }
}
