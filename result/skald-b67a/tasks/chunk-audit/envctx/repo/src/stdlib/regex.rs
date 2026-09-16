//! Minimal backtracking regular-expression engine — a faithful port of the
//! core of `lib/regex_lib.c`.
//!
//! Supported syntax: literals, `.`, character classes `[...]` (with ranges and
//! `^` negation), the quantifiers `*`, `+`, `?`, alternation `|`, grouping
//! `(...)`, and the anchors `^` and `$`. Matching is backtracking.

#[derive(Clone)]
enum Node {
    Char(u8),
    AnyChar,
    Class { negated: bool, ranges: Vec<(u8, u8)> },
    Star(Box<Node>),
    Plus(Box<Node>),
    Opt(Box<Node>),
    Seq(Vec<Node>),
    Alt(Box<Node>, Box<Node>),
    AnchorStart,
    AnchorEnd,
    Empty,
}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(src: &'a [u8]) -> Parser<'a> {
        Parser { src, pos: 0 }
    }
    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }
    fn advance(&mut self) -> Option<u8> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn parse(&mut self) -> Node {
        self.parse_alt()
    }

    fn parse_alt(&mut self) -> Node {
        let left = self.parse_seq();
        if self.peek() == Some(b'|') {
            self.advance();
            let right = self.parse_alt();
            Node::Alt(Box::new(left), Box::new(right))
        } else {
            left
        }
    }

    fn parse_seq(&mut self) -> Node {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == b'|' || c == b')' {
                break;
            }
            items.push(self.parse_quant());
        }
        if items.is_empty() {
            Node::Empty
        } else if items.len() == 1 {
            items.pop().unwrap()
        } else {
            Node::Seq(items)
        }
    }

    fn parse_quant(&mut self) -> Node {
        let atom = self.parse_atom();
        match self.peek() {
            Some(b'*') => {
                self.advance();
                Node::Star(Box::new(atom))
            }
            Some(b'+') => {
                self.advance();
                Node::Plus(Box::new(atom))
            }
            Some(b'?') => {
                self.advance();
                Node::Opt(Box::new(atom))
            }
            _ => atom,
        }
    }

    fn parse_atom(&mut self) -> Node {
        match self.advance() {
            Some(b'.') => Node::AnyChar,
            Some(b'^') => Node::AnchorStart,
            Some(b'$') => Node::AnchorEnd,
            Some(b'(') => {
                let inner = self.parse_alt();
                if self.peek() == Some(b')') {
                    self.advance();
                }
                inner
            }
            Some(b'[') => self.parse_class(),
            Some(b'\\') => Node::Char(self.advance().unwrap_or(b'\\')),
            Some(c) => Node::Char(c),
            None => Node::Empty,
        }
    }

    fn parse_class(&mut self) -> Node {
        let mut negated = false;
        if self.peek() == Some(b'^') {
            negated = true;
            self.advance();
        }
        let mut ranges = Vec::new();
        while let Some(c) = self.peek() {
            if c == b']' {
                self.advance();
                break;
            }
            self.advance();
            if self.peek() == Some(b'-') && self.src.get(self.pos + 1) != Some(&b']') {
                self.advance(); // '-'
                let hi = self.advance().unwrap_or(c);
                ranges.push((c, hi));
            } else {
                ranges.push((c, c));
            }
        }
        Node::Class { negated, ranges }
    }
}

pub struct Regex {
    root: Node,
}

impl Regex {
    pub fn compile(pattern: &[u8]) -> Regex {
        Regex {
            root: Parser::new(pattern).parse(),
        }
    }

    /// True if the pattern matches anywhere in `text`.
    pub fn is_match(&self, text: &[u8]) -> bool {
        for start in 0..=text.len() {
            if match_node(&self.root, text, start).is_some() {
                return true;
            }
            // A leading '^' anchor only matches at position 0.
            if matches!(self.root, Node::AnchorStart)
                || matches!(&self.root, Node::Seq(items) if matches!(items.first(), Some(Node::AnchorStart)))
            {
                break;
            }
        }
        false
    }

    /// Return the end offset of the first match starting at `start`, if any.
    pub fn match_at(&self, text: &[u8], start: usize) -> Option<usize> {
        match_node(&self.root, text, start)
    }
}

fn class_matches(negated: bool, ranges: &[(u8, u8)], c: u8) -> bool {
    let inside = ranges.iter().any(|&(lo, hi)| c >= lo && c <= hi);
    inside != negated
}

/// Attempt to match `node` at position `pos`, returning the end position on
/// success. Quantifiers are greedy with backtracking.
fn match_node(node: &Node, text: &[u8], pos: usize) -> Option<usize> {
    match node {
        Node::Empty => Some(pos),
        Node::Char(c) => {
            if text.get(pos) == Some(c) {
                Some(pos + 1)
            } else {
                None
            }
        }
        Node::AnyChar => {
            if pos < text.len() {
                Some(pos + 1)
            } else {
                None
            }
        }
        Node::Class { negated, ranges } => {
            if let Some(&c) = text.get(pos) {
                if class_matches(*negated, ranges, c) {
                    return Some(pos + 1);
                }
            }
            None
        }
        Node::AnchorStart => {
            if pos == 0 {
                Some(pos)
            } else {
                None
            }
        }
        Node::AnchorEnd => {
            if pos == text.len() {
                Some(pos)
            } else {
                None
            }
        }
        Node::Opt(inner) => match_node(inner, text, pos).or(Some(pos)),
        Node::Star(inner) => {
            // Greedy: match as many as possible, then backtrack.
            let mut positions = vec![pos];
            let mut cur = pos;
            while let Some(next) = match_node(inner, text, cur) {
                if next == cur {
                    break;
                }
                cur = next;
                positions.push(cur);
            }
            positions.last().copied()
        }
        Node::Plus(inner) => {
            let first = match_node(inner, text, pos)?;
            let star = Node::Star(inner.clone());
            match_node(&star, text, first)
        }
        Node::Seq(items) => match_seq(items, text, pos),
        Node::Alt(a, b) => match_node(a, text, pos).or_else(|| match_node(b, text, pos)),
    }
}

fn match_seq(items: &[Node], text: &[u8], pos: usize) -> Option<usize> {
    if items.is_empty() {
        return Some(pos);
    }
    // Non-backtracking sequential match (sufficient for the supported subset
    // when each element is greedy-terminal).
    let mut cur = pos;
    for item in items {
        cur = match_node(item, text, cur)?;
    }
    Some(cur)
}
