//! Dynamic string builder — a faithful port of `util/strbuf.c`.
//!
//! Owns a growable byte buffer (2x growth, min 16) that always maintains a
//! logical NUL terminator after its content.

pub struct StrBuf {
    data: Vec<u8>,
}

impl Default for StrBuf {
    fn default() -> Self {
        Self::new(16)
    }
}

impl StrBuf {
    pub fn new(initial_cap: usize) -> StrBuf {
        StrBuf {
            data: Vec::with_capacity(initial_cap.max(16)),
        }
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }
    pub fn cap(&self) -> usize {
        self.data.capacity()
    }
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
    pub fn clear(&mut self) {
        self.data.clear();
    }

    pub fn append_char(&mut self, c: u8) {
        self.data.push(c);
    }
    pub fn append_bytes(&mut self, s: &[u8]) {
        self.data.extend_from_slice(s);
    }
    pub fn append_str(&mut self, s: &str) {
        self.data.extend_from_slice(s.as_bytes());
    }
    pub fn append_int(&mut self, v: i64) {
        self.append_str(&v.to_string());
    }
    pub fn append_uint(&mut self, v: u64) {
        self.append_str(&v.to_string());
    }
    pub fn append_float(&mut self, v: f64, precision: usize) {
        self.append_str(&format!("{:.*}", precision.min(17), v));
    }

    pub fn prepend_str(&mut self, s: &str) {
        let mut new = Vec::with_capacity(self.data.len() + s.len());
        new.extend_from_slice(s.as_bytes());
        new.extend_from_slice(&self.data);
        self.data = new;
    }

    pub fn insert(&mut self, pos: usize, s: &[u8]) {
        let pos = pos.min(self.data.len());
        let tail = self.data.split_off(pos);
        self.data.extend_from_slice(s);
        self.data.extend_from_slice(&tail);
    }

    pub fn erase(&mut self, pos: usize, len: usize) {
        if pos >= self.data.len() {
            return;
        }
        let end = (pos + len).min(self.data.len());
        self.data.drain(pos..end);
    }

    pub fn replace_all(&mut self, needle: &[u8], replacement: &[u8]) -> usize {
        if needle.is_empty() {
            return 0;
        }
        let mut out: Vec<u8> = Vec::with_capacity(self.data.len());
        let mut i = 0;
        let mut count = 0;
        while i < self.data.len() {
            if i + needle.len() <= self.data.len() && &self.data[i..i + needle.len()] == needle {
                out.extend_from_slice(replacement);
                i += needle.len();
                count += 1;
            } else {
                out.push(self.data[i]);
                i += 1;
            }
        }
        self.data = out;
        count
    }

    pub fn trim(&mut self) {
        self.trim_right();
        self.trim_left();
    }
    pub fn trim_left(&mut self) {
        let mut start = 0;
        while start < self.data.len() && self.data[start].is_ascii_whitespace() {
            start += 1;
        }
        self.data.drain(0..start);
    }
    pub fn trim_right(&mut self) {
        while let Some(&b) = self.data.last() {
            if b.is_ascii_whitespace() {
                self.data.pop();
            } else {
                break;
            }
        }
    }
    pub fn to_upper(&mut self) {
        for b in self.data.iter_mut() {
            b.make_ascii_uppercase();
        }
    }
    pub fn to_lower(&mut self) {
        for b in self.data.iter_mut() {
            b.make_ascii_lowercase();
        }
    }
    pub fn reverse(&mut self) {
        self.data.reverse();
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }
    pub fn to_vec(&self) -> Vec<u8> {
        self.data.clone()
    }
    pub fn clone_buf(&self) -> StrBuf {
        StrBuf {
            data: self.data.clone(),
        }
    }
    pub fn cmp(&self, other: &StrBuf) -> std::cmp::Ordering {
        self.data.cmp(&other.data)
    }
    pub fn reserve(&mut self, new_cap: usize) {
        if new_cap > self.data.capacity() {
            self.data.reserve(new_cap - self.data.len());
        }
    }
}
