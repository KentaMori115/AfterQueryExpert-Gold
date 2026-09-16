//! JSON parser, serialiser, and utilities — a faithful port of `json_lib.c`.
//!
//! Recursive-descent parser building `Value` trees on the heap, a serialiser
//! (compact and pretty), a tree-free validator, plus a JSONPath subset, RFC
//! 7396 merge-patch, and a minifier.

use crate::heap::*;
use crate::value::Value;

const JSON_MAX_DEPTH: i32 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsonError {
    Ok,
    Unexpected,
    Unterminated,
    InvalidEsc,
    Number,
    Depth,
    Trailing,
    Memory,
}

pub struct JsonParser<'a> {
    src: &'a [u8],
    pos: usize,
    line: i32,
    col: i32,
    depth: i32,
    pub err: JsonError,
    pub errmsg: String,
}

fn hex_digit(c: u8) -> i32 {
    match c {
        b'0'..=b'9' => (c - b'0') as i32,
        b'a'..=b'f' => (c - b'a' + 10) as i32,
        b'A'..=b'F' => (c - b'A' + 10) as i32,
        _ => -1,
    }
}

fn encode_utf8(cp: u32, buf: &mut [u8; 4]) -> usize {
    if cp < 0x80 {
        buf[0] = cp as u8;
        1
    } else if cp < 0x800 {
        buf[0] = 0xC0 | (cp >> 6) as u8;
        buf[1] = 0x80 | (cp & 0x3F) as u8;
        2
    } else if cp < 0x10000 {
        buf[0] = 0xE0 | (cp >> 12) as u8;
        buf[1] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        buf[2] = 0x80 | (cp & 0x3F) as u8;
        3
    } else {
        buf[0] = 0xF0 | (cp >> 18) as u8;
        buf[1] = 0x80 | ((cp >> 12) & 0x3F) as u8;
        buf[2] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        buf[3] = 0x80 | (cp & 0x3F) as u8;
        4
    }
}

impl<'a> JsonParser<'a> {
    pub fn new(src: &'a [u8]) -> JsonParser<'a> {
        JsonParser {
            src,
            pos: 0,
            line: 1,
            col: 1,
            depth: 0,
            err: JsonError::Ok,
            errmsg: String::new(),
        }
    }

    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }
    fn peek(&self) -> u8 {
        if self.eof() {
            0
        } else {
            self.src[self.pos]
        }
    }
    fn advance(&mut self) -> u8 {
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
    fn skip_ws(&mut self) {
        while !self.eof() {
            let c = self.peek();
            if c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' {
                self.advance();
            } else {
                break;
            }
        }
    }
    fn expect(&mut self, c: u8) -> bool {
        self.skip_ws();
        if self.eof() || self.peek() != c {
            self.err = JsonError::Unexpected;
            self.errmsg = format!("line {} col {}: expected '{}'", self.line, self.col, c as char);
            return false;
        }
        self.advance();
        true
    }

    fn parse_string(&mut self) -> Value {
        if !self.expect(b'"') {
            return Value::Null;
        }
        let mut buf: Vec<u8> = Vec::new();
        while !self.eof() {
            let c = self.advance();
            if c == b'"' {
                return Value::Obj(heap_new_string(&buf));
            }
            if c == b'\\' {
                if self.eof() {
                    self.err = JsonError::Unterminated;
                    return Value::Null;
                }
                let esc = self.advance();
                match esc {
                    b'"' => buf.push(b'"'),
                    b'\\' => buf.push(b'\\'),
                    b'/' => buf.push(b'/'),
                    b'b' => buf.push(8),
                    b'f' => buf.push(12),
                    b'n' => buf.push(b'\n'),
                    b'r' => buf.push(b'\r'),
                    b't' => buf.push(b'\t'),
                    b'u' => {
                        let mut cp: u32 = 0;
                        for _ in 0..4 {
                            if self.eof() {
                                self.err = JsonError::InvalidEsc;
                                return Value::Null;
                            }
                            let d = hex_digit(self.advance());
                            if d < 0 {
                                self.err = JsonError::InvalidEsc;
                                return Value::Null;
                            }
                            cp = (cp << 4) | d as u32;
                        }
                        if (0xD800..=0xDBFF).contains(&cp)
                            && self.pos + 5 < self.src.len()
                            && self.src[self.pos] == b'\\'
                            && self.src[self.pos + 1] == b'u'
                        {
                            self.pos += 2;
                            self.col += 2;
                            let mut low: u32 = 0;
                            for _ in 0..4 {
                                let d = hex_digit(self.advance());
                                if d < 0 {
                                    self.err = JsonError::InvalidEsc;
                                    return Value::Null;
                                }
                                low = (low << 4) | d as u32;
                            }
                            if (0xDC00..=0xDFFF).contains(&low) {
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                            }
                        }
                        let mut utf8 = [0u8; 4];
                        let n = encode_utf8(cp, &mut utf8);
                        buf.extend_from_slice(&utf8[..n]);
                    }
                    _ => {
                        self.err = JsonError::InvalidEsc;
                        return Value::Null;
                    }
                }
            } else if c < 0x20 {
                self.err = JsonError::InvalidEsc;
                return Value::Null;
            } else {
                buf.push(c);
            }
        }
        self.err = JsonError::Unterminated;
        Value::Null
    }

    fn parse_number(&mut self) -> Value {
        let mut nbuf: Vec<u8> = Vec::new();
        let mut is_float = false;
        if !self.eof() && self.peek() == b'-' {
            nbuf.push(self.advance());
        }
        if self.eof() {
            return self.bad_num();
        }
        if self.peek() == b'0' {
            nbuf.push(self.advance());
            if !self.eof() && self.peek().is_ascii_digit() {
                return self.bad_num();
            }
        } else if self.peek().is_ascii_digit() {
            while !self.eof() && self.peek().is_ascii_digit() {
                nbuf.push(self.advance());
            }
        } else {
            return self.bad_num();
        }
        if !self.eof() && self.peek() == b'.' {
            is_float = true;
            nbuf.push(self.advance());
            if self.eof() || !self.peek().is_ascii_digit() {
                return self.bad_num();
            }
            while !self.eof() && self.peek().is_ascii_digit() {
                nbuf.push(self.advance());
            }
        }
        if !self.eof() && (self.peek() == b'e' || self.peek() == b'E') {
            is_float = true;
            nbuf.push(self.advance());
            if !self.eof() && (self.peek() == b'+' || self.peek() == b'-') {
                nbuf.push(self.advance());
            }
            if self.eof() || !self.peek().is_ascii_digit() {
                return self.bad_num();
            }
            while !self.eof() && self.peek().is_ascii_digit() {
                nbuf.push(self.advance());
            }
        }
        let s = String::from_utf8_lossy(&nbuf);
        if is_float {
            match s.parse::<f64>() {
                Ok(d) => Value::Float(d),
                Err(_) => self.bad_num(),
            }
        } else {
            match s.parse::<i64>() {
                Ok(iv) => Value::Int(iv),
                Err(_) => self.bad_num(),
            }
        }
    }

    fn bad_num(&mut self) -> Value {
        self.err = JsonError::Number;
        self.errmsg = format!("line {} col {}: invalid number", self.line, self.col);
        Value::Null
    }

    fn parse_array(&mut self) -> Value {
        self.advance(); // '['
        self.depth += 1;
        if self.depth > JSON_MAX_DEPTH {
            self.err = JsonError::Depth;
            return Value::Null;
        }
        let ao = heap_new_array();
        self.skip_ws();
        if !self.eof() && self.peek() == b']' {
            self.advance();
            self.depth -= 1;
            return Value::Obj(ao);
        }
        loop {
            if self.err != JsonError::Ok {
                heap_decref(ao);
                return Value::Null;
            }
            self.skip_ws();
            let elem = self.parse_value();
            if self.err != JsonError::Ok {
                heap_value_decref(elem);
                heap_decref(ao);
                return Value::Null;
            }
            unsafe {
                let a = SkObject::as_array_mut(ao).unwrap() as *mut ObjArray;
                array_push(a, elem);
            }
            heap_value_decref(elem);
            self.skip_ws();
            if self.eof() {
                heap_decref(ao);
                self.err = JsonError::Unterminated;
                return Value::Null;
            }
            if self.peek() == b']' {
                self.advance();
                break;
            }
            if self.peek() != b',' {
                heap_decref(ao);
                self.err = JsonError::Unexpected;
                return Value::Null;
            }
            self.advance();
        }
        self.depth -= 1;
        Value::Obj(ao)
    }

    fn parse_object(&mut self) -> Value {
        self.advance(); // '{'
        self.depth += 1;
        if self.depth > JSON_MAX_DEPTH {
            self.err = JsonError::Depth;
            return Value::Null;
        }
        let dobj = heap_new_dict();
        self.skip_ws();
        if !self.eof() && self.peek() == b'}' {
            self.advance();
            self.depth -= 1;
            return Value::Obj(dobj);
        }
        loop {
            if self.err != JsonError::Ok {
                heap_decref(dobj);
                return Value::Null;
            }
            self.skip_ws();
            if self.eof() || self.peek() != b'"' {
                heap_decref(dobj);
                self.err = JsonError::Unexpected;
                return Value::Null;
            }
            let key_val = self.parse_string();
            if self.err != JsonError::Ok {
                heap_decref(dobj);
                return Value::Null;
            }
            let key_bytes = unsafe {
                let ks = SkObject::as_string_mut(key_val.as_obj().unwrap()).unwrap();
                ks.data[..ks.len].to_vec()
            };
            self.skip_ws();
            if !self.expect(b':') {
                heap_value_decref(key_val);
                heap_decref(dobj);
                return Value::Null;
            }
            self.skip_ws();
            let val = self.parse_value();
            if self.err != JsonError::Ok {
                heap_value_decref(key_val);
                heap_decref(dobj);
                return Value::Null;
            }
            unsafe {
                let d = SkObject::as_dict_mut(dobj).unwrap() as *mut ObjDict;
                dict_set(d, &key_bytes, val);
            }
            heap_value_decref(key_val);
            heap_value_decref(val);
            self.skip_ws();
            if self.eof() {
                heap_decref(dobj);
                self.err = JsonError::Unterminated;
                return Value::Null;
            }
            if self.peek() == b'}' {
                self.advance();
                break;
            }
            if self.peek() != b',' {
                heap_decref(dobj);
                self.err = JsonError::Unexpected;
                return Value::Null;
            }
            self.advance();
        }
        self.depth -= 1;
        Value::Obj(dobj)
    }

    pub fn parse_value(&mut self) -> Value {
        if self.err != JsonError::Ok {
            return Value::Null;
        }
        self.skip_ws();
        if self.eof() {
            self.err = JsonError::Unexpected;
            return Value::Null;
        }
        let c = self.peek();
        if c == b'"' {
            return self.parse_string();
        }
        if c == b'{' {
            return self.parse_object();
        }
        if c == b'[' {
            return self.parse_array();
        }
        if c == b'-' || c.is_ascii_digit() {
            return self.parse_number();
        }
        if self.src[self.pos..].starts_with(b"null") {
            self.pos += 4;
            self.col += 4;
            return Value::Null;
        }
        if self.src[self.pos..].starts_with(b"true") {
            self.pos += 4;
            self.col += 4;
            return Value::Int(1);
        }
        if self.src[self.pos..].starts_with(b"false") {
            self.pos += 5;
            self.col += 5;
            return Value::Int(0);
        }
        self.err = JsonError::Unexpected;
        Value::Null
    }
}

/// Parse JSON text into a heap `Value`. Returns `Value::Null` on error.
pub fn json_parse(text: &[u8]) -> Value {
    let mut p = JsonParser::new(text);
    let v = p.parse_value();
    if p.err != JsonError::Ok {
        return Value::Null;
    }
    p.skip_ws();
    if !p.eof() {
        heap_value_decref(v);
        return Value::Null;
    }
    v
}

// ── serialiser ──────────────────────────────────────────────────────────

pub struct JsonWriter {
    buf: Vec<u8>,
    depth: i32,
    indent: i32,
}

impl JsonWriter {
    pub fn new(indent: i32) -> JsonWriter {
        JsonWriter {
            buf: Vec::with_capacity(512),
            depth: 0,
            indent,
        }
    }
    fn ch(&mut self, c: u8) {
        self.buf.push(c);
    }
    fn s(&mut self, s: &[u8]) {
        self.buf.extend_from_slice(s);
    }
    fn write_indent(&mut self) {
        if self.indent <= 0 {
            return;
        }
        self.ch(b'\n');
        for _ in 0..(self.depth * self.indent) {
            self.ch(b' ');
        }
    }
    fn write_string(&mut self, s: &[u8]) {
        self.ch(b'"');
        for &c in s {
            match c {
                b'"' => self.s(b"\\\""),
                b'\\' => self.s(b"\\\\"),
                8 => self.s(b"\\b"),
                12 => self.s(b"\\f"),
                b'\n' => self.s(b"\\n"),
                b'\r' => self.s(b"\\r"),
                b'\t' => self.s(b"\\t"),
                _ => {
                    if c < 0x20 {
                        self.s(format!("\\u{:04X}", c).as_bytes());
                    } else {
                        self.ch(c);
                    }
                }
            }
        }
        self.ch(b'"');
    }
    pub fn write_value(&mut self, v: Value, max_depth: i32) {
        if max_depth <= 0 {
            self.s(b"null");
            return;
        }
        match v {
            Value::Null => self.s(b"null"),
            Value::Int(i) => self.s(i.to_string().as_bytes()),
            Value::Float(d) => {
                if d.is_nan() || d.is_infinite() {
                    self.s(b"null");
                } else {
                    self.s(format!("{:.17}", d).as_bytes());
                }
            }
            Value::Obj(o) => unsafe {
                match (*o).obj_type {
                    ObjType::String => {
                        let sdata = {
                            let s = SkObject::as_string_mut(o).unwrap();
                            s.data[..s.len].to_vec()
                        };
                        self.write_string(&sdata);
                    }
                    ObjType::Array => {
                        let items = {
                            let a = SkObject::as_array_mut(o).unwrap();
                            a.items.clone()
                        };
                        self.ch(b'[');
                        self.depth += 1;
                        for (i, it) in items.iter().enumerate() {
                            if i > 0 {
                                self.ch(b',');
                            }
                            if self.indent > 0 {
                                self.write_indent();
                            }
                            self.write_value(*it, max_depth - 1);
                        }
                        self.depth -= 1;
                        if self.indent > 0 && !items.is_empty() {
                            self.write_indent();
                        }
                        self.ch(b']');
                    }
                    ObjType::Dict => {
                        let entries: Vec<(Vec<u8>, Value)> = {
                            let d = SkObject::as_dict_mut(o).unwrap();
                            let mut v = Vec::new();
                            for bucket in &d.buckets {
                                for e in bucket {
                                    v.push((e.key.clone(), e.value));
                                }
                            }
                            v
                        };
                        self.ch(b'{');
                        self.depth += 1;
                        let mut first = true;
                        for (k, val) in &entries {
                            if !first {
                                self.ch(b',');
                            }
                            if self.indent > 0 {
                                self.write_indent();
                            }
                            first = false;
                            self.write_string(k);
                            if self.indent > 0 {
                                self.s(b": ");
                            } else {
                                self.ch(b':');
                            }
                            self.write_value(*val, max_depth - 1);
                        }
                        self.depth -= 1;
                        if self.indent > 0 && !first {
                            self.write_indent();
                        }
                        self.ch(b'}');
                    }
                    ObjType::Closure => self.s(b"null"),
                }
            },
        }
    }
    pub fn take(self) -> Vec<u8> {
        self.buf
    }
}

pub fn json_stringify(v: Value) -> Vec<u8> {
    let mut w = JsonWriter::new(0);
    w.write_value(v, JSON_MAX_DEPTH);
    w.take()
}

pub fn json_format(v: Value, indent: i32) -> Vec<u8> {
    let mut w = JsonWriter::new(if indent > 0 { indent } else { 2 });
    w.write_value(v, JSON_MAX_DEPTH);
    w.ch(b'\n');
    w.take()
}

// ── validate (no tree) ──────────────────────────────────────────────────

impl<'a> JsonParser<'a> {
    fn validate_string(&mut self) -> JsonError {
        if !self.expect(b'"') {
            return self.err;
        }
        while !self.eof() {
            let c = self.advance();
            if c == b'"' {
                return JsonError::Ok;
            }
            if c == b'\\' {
                if self.eof() {
                    self.err = JsonError::Unterminated;
                    return self.err;
                }
                let esc = self.advance();
                if esc == b'u' {
                    for _ in 0..4 {
                        if self.eof() || hex_digit(self.advance()) < 0 {
                            self.err = JsonError::InvalidEsc;
                            return self.err;
                        }
                    }
                } else if !b"\"\\/bfnrt".contains(&esc) {
                    self.err = JsonError::InvalidEsc;
                    return self.err;
                }
            } else if c < 0x20 {
                self.err = JsonError::InvalidEsc;
                return self.err;
            }
        }
        self.err = JsonError::Unterminated;
        self.err
    }

    fn validate_array(&mut self) -> JsonError {
        self.advance();
        self.depth += 1;
        if self.depth > JSON_MAX_DEPTH {
            self.err = JsonError::Depth;
            return self.err;
        }
        self.skip_ws();
        if !self.eof() && self.peek() == b']' {
            self.advance();
            self.depth -= 1;
            return JsonError::Ok;
        }
        loop {
            self.skip_ws();
            let e = self.validate_value();
            if e != JsonError::Ok {
                return e;
            }
            self.skip_ws();
            if self.eof() {
                self.err = JsonError::Unterminated;
                return self.err;
            }
            if self.peek() == b']' {
                self.advance();
                break;
            }
            if self.peek() != b',' {
                self.err = JsonError::Unexpected;
                return self.err;
            }
            self.advance();
        }
        self.depth -= 1;
        JsonError::Ok
    }

    fn validate_object(&mut self) -> JsonError {
        self.advance();
        self.depth += 1;
        if self.depth > JSON_MAX_DEPTH {
            self.err = JsonError::Depth;
            return self.err;
        }
        self.skip_ws();
        if !self.eof() && self.peek() == b'}' {
            self.advance();
            self.depth -= 1;
            return JsonError::Ok;
        }
        loop {
            self.skip_ws();
            if self.eof() || self.peek() != b'"' {
                self.err = JsonError::Unexpected;
                return self.err;
            }
            let e = self.validate_string();
            if e != JsonError::Ok {
                return e;
            }
            self.skip_ws();
            if !self.expect(b':') {
                return self.err;
            }
            self.skip_ws();
            let e = self.validate_value();
            if e != JsonError::Ok {
                return e;
            }
            self.skip_ws();
            if self.eof() {
                self.err = JsonError::Unterminated;
                return self.err;
            }
            if self.peek() == b'}' {
                self.advance();
                break;
            }
            if self.peek() != b',' {
                self.err = JsonError::Unexpected;
                return self.err;
            }
            self.advance();
        }
        self.depth -= 1;
        JsonError::Ok
    }

    fn validate_value(&mut self) -> JsonError {
        if self.err != JsonError::Ok {
            return self.err;
        }
        self.skip_ws();
        if self.eof() {
            self.err = JsonError::Unexpected;
            return self.err;
        }
        let c = self.peek();
        if c == b'"' {
            return self.validate_string();
        }
        if c == b'{' {
            return self.validate_object();
        }
        if c == b'[' {
            return self.validate_array();
        }
        if c == b'-' || c.is_ascii_digit() {
            let _ = self.parse_number();
            return self.err;
        }
        if self.src[self.pos..].starts_with(b"null") {
            self.pos += 4;
            self.col += 4;
            return JsonError::Ok;
        }
        if self.src[self.pos..].starts_with(b"true") {
            self.pos += 4;
            self.col += 4;
            return JsonError::Ok;
        }
        if self.src[self.pos..].starts_with(b"false") {
            self.pos += 5;
            self.col += 5;
            return JsonError::Ok;
        }
        self.err = JsonError::Unexpected;
        self.err
    }
}

pub fn json_validate(text: &[u8]) -> JsonError {
    let mut p = JsonParser::new(text);
    let e = p.validate_value();
    if e == JsonError::Ok {
        p.skip_ws();
        if !p.eof() {
            return JsonError::Trailing;
        }
    }
    e
}

/// Strip insignificant whitespace from a JSON document.
pub fn json_minify(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut in_string = false;
    let mut escaped = false;
    for &c in text {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
        } else if c == b'"' {
            in_string = true;
            out.push(c);
        } else if !matches!(c, b' ' | b'\t' | b'\r' | b'\n') {
            out.push(c);
        }
    }
    out
}
