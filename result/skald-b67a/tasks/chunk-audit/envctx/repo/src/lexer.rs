//! Lexer for the skald scripting language — a faithful port of `lexer.c`.
//!
//! Scans a byte source into tokens: identifiers/keywords, integer literals
//! (decimal, `0x`, `0b`, `0o`, underscores), floats (`1.0`, `1e10`, `1_000.0`),
//! strings (`"..."`, `"""..."""`, `r"..."`) with escape handling, char
//! literals, comments, and the full operator/punctuation set.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum TokenType {
    Eof = 0,
    Error,
    Ident,
    Int,
    Float,
    Str,
    Char,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Caret,
    Amp,
    Pipe,
    Tilde,
    Bang,
    Lt,
    Gt,
    Eq,
    Dot,
    Comma,
    Semi,
    Colon,
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    PlusEq,
    MinusEq,
    StarEq,
    SlashEq,
    PercentEq,
    AmpEq,
    PipeEq,
    CaretEq,
    EqEq,
    BangEq,
    LtEq,
    GtEq,
    LtLt,
    GtGt,
    AmpAmp,
    PipePipe,
    Arrow,
    FatArrow,
    DotDot,
    DotDotDot,
    PlusPlus,
    MinusMinus,
    Question,
    QuestionDot,
    ColonColon,
    At,
    Hash,
    Dollar,
    Let,
    Var,
    Const,
    Fn,
    Return,
    If,
    Else,
    Elif,
    While,
    For,
    In,
    Break,
    Continue,
    Match,
    Case,
    Default,
    Class,
    Extends,
    New,
    SelfKw,
    Super,
    Import,
    From,
    As,
    Export,
    Try,
    Catch,
    Finally,
    Throw,
    Async,
    Await,
    Yield,
    Null,
    True,
    False,
    And,
    Or,
    Not,
    Is,
    Typeof,
    Void,
    Instanceof,
    Delete,
    Sizeof,
    Count,
}

#[derive(Clone, Copy)]
pub struct Token {
    pub ttype: TokenType,
    pub start: usize,
    pub len: usize,
    pub line: i32,
    pub col: i32,
    /// Integer/char value or float bits, depending on `ttype`.
    pub ival: i64,
    pub fval: f64,
}

impl Token {
    fn blank(ttype: TokenType, line: i32, col: i32) -> Token {
        Token {
            ttype,
            start: 0,
            len: 0,
            line,
            col,
            ival: 0,
            fval: 0.0,
        }
    }
}

pub struct Lexer<'a> {
    src: &'a [u8],
    pos: usize,
    line: i32,
    col: i32,
    peeked: Option<Token>,
    pub errmsg: String,
}

struct Keyword {
    word: &'static [u8],
    ttype: TokenType,
}

const KEYWORDS: &[Keyword] = &[
    Keyword { word: b"let", ttype: TokenType::Let },
    Keyword { word: b"var", ttype: TokenType::Var },
    Keyword { word: b"const", ttype: TokenType::Const },
    Keyword { word: b"fn", ttype: TokenType::Fn },
    Keyword { word: b"return", ttype: TokenType::Return },
    Keyword { word: b"if", ttype: TokenType::If },
    Keyword { word: b"else", ttype: TokenType::Else },
    Keyword { word: b"elif", ttype: TokenType::Elif },
    Keyword { word: b"while", ttype: TokenType::While },
    Keyword { word: b"for", ttype: TokenType::For },
    Keyword { word: b"in", ttype: TokenType::In },
    Keyword { word: b"break", ttype: TokenType::Break },
    Keyword { word: b"continue", ttype: TokenType::Continue },
    Keyword { word: b"match", ttype: TokenType::Match },
    Keyword { word: b"case", ttype: TokenType::Case },
    Keyword { word: b"default", ttype: TokenType::Default },
    Keyword { word: b"class", ttype: TokenType::Class },
    Keyword { word: b"extends", ttype: TokenType::Extends },
    Keyword { word: b"new", ttype: TokenType::New },
    Keyword { word: b"self", ttype: TokenType::SelfKw },
    Keyword { word: b"super", ttype: TokenType::Super },
    Keyword { word: b"import", ttype: TokenType::Import },
    Keyword { word: b"from", ttype: TokenType::From },
    Keyword { word: b"as", ttype: TokenType::As },
    Keyword { word: b"export", ttype: TokenType::Export },
    Keyword { word: b"try", ttype: TokenType::Try },
    Keyword { word: b"catch", ttype: TokenType::Catch },
    Keyword { word: b"finally", ttype: TokenType::Finally },
    Keyword { word: b"throw", ttype: TokenType::Throw },
    Keyword { word: b"async", ttype: TokenType::Async },
    Keyword { word: b"await", ttype: TokenType::Await },
    Keyword { word: b"yield", ttype: TokenType::Yield },
    Keyword { word: b"null", ttype: TokenType::Null },
    Keyword { word: b"true", ttype: TokenType::True },
    Keyword { word: b"false", ttype: TokenType::False },
    Keyword { word: b"and", ttype: TokenType::And },
    Keyword { word: b"or", ttype: TokenType::Or },
    Keyword { word: b"not", ttype: TokenType::Not },
    Keyword { word: b"is", ttype: TokenType::Is },
    Keyword { word: b"typeof", ttype: TokenType::Typeof },
    Keyword { word: b"void", ttype: TokenType::Void },
    Keyword { word: b"instanceof", ttype: TokenType::Instanceof },
    Keyword { word: b"delete", ttype: TokenType::Delete },
    Keyword { word: b"sizeof", ttype: TokenType::Sizeof },
];

fn keyword_lookup(s: &[u8]) -> TokenType {
    for k in KEYWORDS {
        if k.word == s {
            return k.ttype;
        }
    }
    TokenType::Ident
}

fn hex_digit(c: u8) -> i32 {
    match c {
        b'0'..=b'9' => (c - b'0') as i32,
        b'a'..=b'f' => (c - b'a' + 10) as i32,
        b'A'..=b'F' => (c - b'A' + 10) as i32,
        _ => -1,
    }
}

impl<'a> Lexer<'a> {
    pub fn new(src: &'a [u8]) -> Lexer<'a> {
        Lexer {
            src,
            pos: 0,
            line: 1,
            col: 1,
            peeked: None,
            errmsg: String::new(),
        }
    }

    fn at_end(&self) -> bool {
        self.pos >= self.src.len()
    }
    fn cur(&self) -> u8 {
        if self.at_end() {
            0
        } else {
            self.src[self.pos]
        }
    }
    fn peek1(&self) -> u8 {
        if self.pos + 1 < self.src.len() {
            self.src[self.pos + 1]
        } else {
            0
        }
    }
    fn peek2(&self) -> u8 {
        if self.pos + 2 < self.src.len() {
            self.src[self.pos + 2]
        } else {
            0
        }
    }
    fn advance(&mut self) -> u8 {
        if self.at_end() {
            return 0;
        }
        let c = self.src[self.pos];
        self.pos += 1;
        if c == b'\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
        }
        c
    }

    fn skip_whitespace(&mut self) {
        loop {
            let c = self.cur();
            if c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' {
                self.advance();
            } else if c == b'/' && self.peek1() == b'/' {
                while !self.at_end() && self.cur() != b'\n' {
                    self.advance();
                }
            } else if c == b'/' && self.peek1() == b'*' {
                let mut depth = 1;
                self.advance();
                self.advance();
                while !self.at_end() && depth > 0 {
                    if self.cur() == b'/' && self.peek1() == b'*' {
                        depth += 1;
                        self.advance();
                        self.advance();
                    } else if self.cur() == b'*' && self.peek1() == b'/' {
                        depth -= 1;
                        self.advance();
                        self.advance();
                    } else {
                        self.advance();
                    }
                }
            } else {
                break;
            }
        }
    }

    fn make_token(&self, ttype: TokenType, start: usize, line: i32, col: i32) -> Token {
        Token {
            ttype,
            start,
            len: self.pos - start,
            line,
            col,
            ival: 0,
            fval: 0.0,
        }
    }

    fn make_error(&mut self, msg: &str, line: i32, col: i32) -> Token {
        self.errmsg = msg.to_string();
        Token {
            ttype: TokenType::Error,
            start: 0,
            len: self.errmsg.len(),
            line,
            col,
            ival: 0,
            fval: 0.0,
        }
    }

    /// Parse an escape sequence after the backslash; returns codepoint or -1.
    fn parse_escape(&mut self) -> i32 {
        if self.at_end() {
            return -1;
        }
        let c = self.advance();
        match c {
            b'n' => b'\n' as i32,
            b'r' => b'\r' as i32,
            b't' => b'\t' as i32,
            b'\\' => b'\\' as i32,
            b'\'' => b'\'' as i32,
            b'"' => b'"' as i32,
            b'0' => 0,
            b'a' => 7,
            b'b' => 8,
            b'f' => 12,
            b'v' => 11,
            b'x' => {
                let h1 = hex_digit(self.cur());
                if h1 < 0 {
                    self.errmsg = "\\x needs 2 hex digits".into();
                    return -1;
                }
                self.advance();
                let h2 = hex_digit(self.cur());
                if h2 < 0 {
                    self.errmsg = "\\x needs 2 hex digits".into();
                    return -1;
                }
                self.advance();
                h1 * 16 + h2
            }
            b'u' => {
                let mut cp = 0;
                for _ in 0..4 {
                    let h = hex_digit(self.cur());
                    if h < 0 {
                        self.errmsg = "\\u needs 4 hex digits".into();
                        return -1;
                    }
                    cp = cp * 16 + h;
                    self.advance();
                }
                cp
            }
            b'U' => {
                let mut cp: i64 = 0;
                for _ in 0..8 {
                    let h = hex_digit(self.cur());
                    if h < 0 {
                        self.errmsg = "\\U needs 8 hex digits".into();
                        return -1;
                    }
                    cp = cp * 16 + h as i64;
                    self.advance();
                }
                cp as i32
            }
            _ => {
                self.errmsg = format!("unknown escape '\\{}'", c as char);
                -1
            }
        }
    }

    fn scan_number(&mut self, start: usize, line: i32, col: i32) -> Token {
        let first = self.src[start];
        let mut is_float = false;

        if first == b'0' {
            let next = self.cur();
            if next == b'x' || next == b'X' {
                self.advance();
                if hex_digit(self.cur()) < 0 && self.cur() != b'_' {
                    return self.make_error("invalid hex literal", line, col);
                }
                let mut val: u64 = 0;
                while !self.at_end() {
                    let c = self.cur();
                    if c == b'_' {
                        self.advance();
                        continue;
                    }
                    let d = hex_digit(c);
                    if d < 0 {
                        break;
                    }
                    val = val.wrapping_mul(16).wrapping_add(d as u64);
                    self.advance();
                }
                let mut t = self.make_token(TokenType::Int, start, line, col);
                t.ival = val as i64;
                return t;
            } else if next == b'b' || next == b'B' {
                self.advance();
                let mut val: u64 = 0;
                while !self.at_end() {
                    let c = self.cur();
                    if c == b'_' {
                        self.advance();
                        continue;
                    }
                    if c != b'0' && c != b'1' {
                        break;
                    }
                    val = val.wrapping_mul(2).wrapping_add((c - b'0') as u64);
                    self.advance();
                }
                let mut t = self.make_token(TokenType::Int, start, line, col);
                t.ival = val as i64;
                return t;
            } else if next == b'o' || next == b'O' {
                self.advance();
                let mut val: u64 = 0;
                while !self.at_end() {
                    let c = self.cur();
                    if c == b'_' {
                        self.advance();
                        continue;
                    }
                    if !(b'0'..=b'7').contains(&c) {
                        break;
                    }
                    val = val.wrapping_mul(8).wrapping_add((c - b'0') as u64);
                    self.advance();
                }
                let mut t = self.make_token(TokenType::Int, start, line, col);
                t.ival = val as i64;
                return t;
            }
        }

        while !self.at_end() {
            let c = self.cur();
            if c == b'_' || c.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }

        if self.cur() == b'.' && self.peek1() != b'.' {
            is_float = true;
            self.advance();
            while !self.at_end() {
                let c = self.cur();
                if c == b'_' || c.is_ascii_digit() {
                    self.advance();
                } else {
                    break;
                }
            }
        }

        if self.cur() == b'e' || self.cur() == b'E' {
            is_float = true;
            self.advance();
            if self.cur() == b'+' || self.cur() == b'-' {
                self.advance();
            }
            if !self.cur().is_ascii_digit() {
                return self.make_error("invalid float exponent", line, col);
            }
            while !self.at_end() {
                let c = self.cur();
                if c == b'_' || c.is_ascii_digit() {
                    self.advance();
                } else {
                    break;
                }
            }
        }

        let mut t = self.make_token(
            if is_float {
                TokenType::Float
            } else {
                TokenType::Int
            },
            start,
            line,
            col,
        );
        let raw: Vec<u8> = self.src[start..self.pos]
            .iter()
            .copied()
            .filter(|&c| c != b'_')
            .collect();
        if is_float {
            let s = String::from_utf8_lossy(&raw);
            t.fval = s.parse::<f64>().unwrap_or(0.0);
        } else {
            let mut val: u64 = 0;
            for &c in &raw {
                val = val.wrapping_mul(10).wrapping_add((c - b'0') as u64);
            }
            t.ival = val as i64;
        }
        t
    }

    fn scan_string(&mut self, start: usize, line: i32, col: i32) -> Token {
        let mut multiline = false;
        if self.cur() == b'"' && self.peek1() == b'"' {
            multiline = true;
            self.advance();
            self.advance();
        }
        while !self.at_end() {
            let c = self.cur();
            if multiline {
                if c == b'"' && self.peek1() == b'"' && self.peek2() == b'"' {
                    self.advance();
                    self.advance();
                    self.advance();
                    return self.make_token(TokenType::Str, start, line, col);
                }
                if c == b'\\' {
                    self.advance();
                    if self.parse_escape() < 0 {
                        let m = self.errmsg.clone();
                        return self.make_error(&m, line, col);
                    }
                } else {
                    self.advance();
                }
            } else {
                if c == b'"' {
                    self.advance();
                    return self.make_token(TokenType::Str, start, line, col);
                }
                if c == b'\n' {
                    return self.make_error("unterminated string literal", line, col);
                }
                if c == b'\\' {
                    self.advance();
                    if self.parse_escape() < 0 {
                        let m = self.errmsg.clone();
                        return self.make_error(&m, line, col);
                    }
                } else {
                    self.advance();
                }
            }
        }
        self.make_error("unterminated string literal", line, col)
    }

    fn scan_raw_string(&mut self, start: usize, line: i32, col: i32) -> Token {
        self.advance(); // consume 'r'
        if self.cur() != b'"' {
            return self.make_error("expected '\"' after 'r'", line, col);
        }
        self.advance(); // opening '"'
        while !self.at_end() {
            if self.cur() == b'"' {
                self.advance();
                return self.make_token(TokenType::Str, start, line, col);
            }
            self.advance();
        }
        self.make_error("unterminated raw string", line, col)
    }

    fn scan_char(&mut self, start: usize, line: i32, col: i32) -> Token {
        let c = self.cur();
        let cp: i32;
        if c == b'\\' {
            self.advance();
            cp = self.parse_escape();
            if cp < 0 {
                let m = self.errmsg.clone();
                return self.make_error(&m, line, col);
            }
        } else if c == b'\'' || c == 0 {
            return self.make_error("empty char literal", line, col);
        } else {
            cp = c as i32;
            self.advance();
        }
        if self.cur() != b'\'' {
            return self.make_error("char literal too long", line, col);
        }
        self.advance();
        let mut t = self.make_token(TokenType::Char, start, line, col);
        t.ival = cp as i64;
        t
    }

    fn scan_one(&mut self) -> Token {
        self.skip_whitespace();
        if self.at_end() {
            let mut t = Token::blank(TokenType::Eof, self.line, self.col);
            t.start = self.pos;
            return t;
        }
        let start = self.pos;
        let line = self.line;
        let col = self.col;
        let c = self.advance();

        if c == b'_' || c.is_ascii_alphabetic() {
            if c == b'r' && self.cur() == b'"' {
                self.pos = start;
                self.col = col;
                return self.scan_raw_string(start, line, col);
            }
            while !self.at_end() {
                let nc = self.cur();
                if nc == b'_' || nc.is_ascii_alphanumeric() {
                    self.advance();
                } else {
                    break;
                }
            }
            let kw = keyword_lookup(&self.src[start..self.pos]);
            let mut t = self.make_token(kw, start, line, col);
            if kw == TokenType::True {
                t.ival = 1;
            }
            if kw == TokenType::False {
                t.ival = 0;
            }
            return t;
        }

        if c.is_ascii_digit() {
            return self.scan_number(start, line, col);
        }
        if c == b'"' {
            return self.scan_string(start, line, col);
        }
        if c == b'\'' {
            return self.scan_char(start, line, col);
        }

        macro_rules! tk {
            ($t:expr) => {
                self.make_token($t, start, line, col)
            };
        }
        match c {
            b'+' => {
                if self.cur() == b'+' {
                    self.advance();
                    tk!(TokenType::PlusPlus)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::PlusEq)
                } else {
                    tk!(TokenType::Plus)
                }
            }
            b'-' => {
                if self.cur() == b'-' {
                    self.advance();
                    tk!(TokenType::MinusMinus)
                } else if self.cur() == b'>' {
                    self.advance();
                    tk!(TokenType::Arrow)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::MinusEq)
                } else {
                    tk!(TokenType::Minus)
                }
            }
            b'*' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::StarEq)
                } else {
                    tk!(TokenType::Star)
                }
            }
            b'/' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::SlashEq)
                } else {
                    tk!(TokenType::Slash)
                }
            }
            b'%' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::PercentEq)
                } else {
                    tk!(TokenType::Percent)
                }
            }
            b'^' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::CaretEq)
                } else {
                    tk!(TokenType::Caret)
                }
            }
            b'&' => {
                if self.cur() == b'&' {
                    self.advance();
                    tk!(TokenType::AmpAmp)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::AmpEq)
                } else {
                    tk!(TokenType::Amp)
                }
            }
            b'|' => {
                if self.cur() == b'|' {
                    self.advance();
                    tk!(TokenType::PipePipe)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::PipeEq)
                } else {
                    tk!(TokenType::Pipe)
                }
            }
            b'~' => tk!(TokenType::Tilde),
            b'!' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::BangEq)
                } else {
                    tk!(TokenType::Bang)
                }
            }
            b'<' => {
                if self.cur() == b'<' {
                    self.advance();
                    tk!(TokenType::LtLt)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::LtEq)
                } else {
                    tk!(TokenType::Lt)
                }
            }
            b'>' => {
                if self.cur() == b'>' {
                    self.advance();
                    tk!(TokenType::GtGt)
                } else if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::GtEq)
                } else {
                    tk!(TokenType::Gt)
                }
            }
            b'=' => {
                if self.cur() == b'=' {
                    self.advance();
                    tk!(TokenType::EqEq)
                } else if self.cur() == b'>' {
                    self.advance();
                    tk!(TokenType::FatArrow)
                } else {
                    tk!(TokenType::Eq)
                }
            }
            b'.' => {
                if self.cur() == b'.' && self.peek1() == b'.' {
                    self.advance();
                    self.advance();
                    tk!(TokenType::DotDotDot)
                } else if self.cur() == b'.' {
                    self.advance();
                    tk!(TokenType::DotDot)
                } else if self.cur().is_ascii_digit() {
                    self.pos = start;
                    self.col = col;
                    self.advance();
                    while !self.at_end() && self.cur().is_ascii_digit() {
                        self.advance();
                    }
                    if self.cur() == b'e' || self.cur() == b'E' {
                        self.advance();
                        if self.cur() == b'+' || self.cur() == b'-' {
                            self.advance();
                        }
                        while !self.at_end() && self.cur().is_ascii_digit() {
                            self.advance();
                        }
                    }
                    let mut t = self.make_token(TokenType::Float, start, line, col);
                    let raw: Vec<u8> = self.src[start..self.pos]
                        .iter()
                        .copied()
                        .filter(|&x| x != b'_')
                        .collect();
                    t.fval = String::from_utf8_lossy(&raw).parse::<f64>().unwrap_or(0.0);
                    t
                } else {
                    tk!(TokenType::Dot)
                }
            }
            b',' => tk!(TokenType::Comma),
            b';' => tk!(TokenType::Semi),
            b':' => {
                if self.cur() == b':' {
                    self.advance();
                    tk!(TokenType::ColonColon)
                } else {
                    tk!(TokenType::Colon)
                }
            }
            b'{' => tk!(TokenType::LBrace),
            b'}' => tk!(TokenType::RBrace),
            b'(' => tk!(TokenType::LParen),
            b')' => tk!(TokenType::RParen),
            b'[' => tk!(TokenType::LBracket),
            b']' => tk!(TokenType::RBracket),
            b'?' => {
                if self.cur() == b'.' {
                    self.advance();
                    tk!(TokenType::QuestionDot)
                } else {
                    tk!(TokenType::Question)
                }
            }
            b'@' => tk!(TokenType::At),
            b'#' => tk!(TokenType::Hash),
            b'$' => tk!(TokenType::Dollar),
            _ => {
                let msg = format!("unexpected character '{}' (0x{:02X})", c as char, c);
                self.make_error(&msg, line, col)
            }
        }
    }

    pub fn next_token(&mut self) -> Token {
        if let Some(t) = self.peeked.take() {
            return t;
        }
        self.scan_one()
    }

    pub fn peek_token(&mut self) -> Token {
        if self.peeked.is_none() {
            self.peeked = Some(self.scan_one());
        }
        self.peeked.unwrap()
    }
}

/// Decode a `TK_STRING` token body into raw bytes (handles `"..."`,
/// `"""..."""`, and `r"..."`), mirroring `lexer_decode_string`.
pub fn decode_string(src: &[u8], tok: Token) -> Vec<u8> {
    let p = &src[tok.start..tok.start + tok.len];
    let mut rem = p.len();
    let mut out: Vec<u8> = Vec::with_capacity(rem + 1);

    let is_raw = rem >= 2 && p[0] == b'r' && p[1] == b'"';
    if is_raw {
        let mut s = 2;
        if rem >= 1 && p[rem - 1] == b'"' {
            rem -= 1;
        }
        out.extend_from_slice(&p[s..rem]);
        let _ = &mut s;
        return out;
    }

    let mut is_triple = false;
    let (mut i, end): (usize, usize) = if rem >= 3 && p[0] == b'"' && p[1] == b'"' && p[2] == b'"' {
        is_triple = true;
        let mut e = rem;
        if e >= 6 && p[e - 3] == b'"' && p[e - 2] == b'"' && p[e - 1] == b'"' {
            e -= 3;
        }
        (3, e)
    } else {
        let mut e = rem;
        if e >= 1 && p[e - 1] == b'"' {
            e -= 1;
        }
        (1, e)
    };

    while i < end {
        let c = p[i];
        i += 1;
        if c == b'\\' && !is_triple {
            if i >= end {
                break;
            }
            let esc = p[i];
            i += 1;
            match esc {
                b'n' => out.push(b'\n'),
                b'r' => out.push(b'\r'),
                b't' => out.push(b'\t'),
                b'\\' => out.push(b'\\'),
                b'\'' => out.push(b'\''),
                b'"' => out.push(b'"'),
                b'0' => out.push(0),
                b'a' => out.push(7),
                b'b' => out.push(8),
                b'f' => out.push(12),
                b'v' => out.push(11),
                b'x' => {
                    if i + 1 < end {
                        let h1 = hex_digit(p[i]);
                        let h2 = hex_digit(p[i + 1]);
                        i += 2;
                        if h1 >= 0 && h2 >= 0 {
                            out.push((h1 * 16 + h2) as u8);
                        }
                    }
                }
                _ => out.push(esc),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Tokenise an entire source buffer and report how many tokens it held.
pub fn tokenize_all(src: &[u8]) -> usize {
    let mut lex = Lexer::new(src);
    let mut count = 0usize;
    loop {
        let t = lex.next_token();
        count += 1;
        if t.ttype == TokenType::Eof || t.ttype == TokenType::Error {
            break;
        }
        if count > 10_000_000 {
            break;
        }
    }
    count
}
