//! In-memory text stream utilities — a faithful port of the pure portion of
//! `lib/io_lib.c`.
//!
//! Line splitting, joining, and a cursor-based line reader over an in-memory
//! byte buffer. No filesystem access.

/// Split a buffer into lines, honouring `\n` and `\r\n`. The terminators are
/// not included in the returned slices.
pub fn split_lines(data: &[u8]) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < data.len() {
        if data[i] == b'\n' {
            let mut end = i;
            if end > start && data[end - 1] == b'\r' {
                end -= 1;
            }
            lines.push(data[start..end].to_vec());
            start = i + 1;
        }
        i += 1;
    }
    if start < data.len() {
        lines.push(data[start..].to_vec());
    }
    lines
}

/// Join lines with `\n`.
pub fn join_lines(lines: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        out.extend_from_slice(line);
    }
    out
}

/// Count lines the way `wc -l` does (number of newline characters).
pub fn count_lines(data: &[u8]) -> usize {
    data.iter().filter(|&&c| c == b'\n').count()
}

/// A forward line reader over a borrowed buffer.
pub struct LineReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> LineReader<'a> {
    pub fn new(data: &'a [u8]) -> LineReader<'a> {
        LineReader { data, pos: 0 }
    }

    pub fn at_end(&self) -> bool {
        self.pos >= self.data.len()
    }

    /// Read the next line (without its terminator), or `None` at end of input.
    pub fn next_line(&mut self) -> Option<&'a [u8]> {
        if self.pos >= self.data.len() {
            return None;
        }
        let start = self.pos;
        while self.pos < self.data.len() && self.data[self.pos] != b'\n' {
            self.pos += 1;
        }
        let mut end = self.pos;
        if end > start && self.data[end - 1] == b'\r' {
            end -= 1;
        }
        if self.pos < self.data.len() {
            self.pos += 1; // consume '\n'
        }
        Some(&self.data[start..end])
    }
}

/// Indent every line of `text` by `n` spaces.
pub fn indent(text: &[u8], n: usize) -> Vec<u8> {
    let prefix = vec![b' '; n];
    let lines = split_lines(text);
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        if !line.is_empty() {
            out.extend_from_slice(&prefix);
        }
        out.extend_from_slice(line);
    }
    out
}
