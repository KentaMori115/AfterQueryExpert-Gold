//! Number formatting and radix conversion — a faithful port of the pure
//! portion of `lib/fmt_lib`.

const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Format an unsigned integer in an arbitrary base (2..=36).
pub fn to_radix(mut v: u64, base: u32) -> Vec<u8> {
    if base < 2 || base > 36 {
        return b"0".to_vec();
    }
    if v == 0 {
        return b"0".to_vec();
    }
    let base = base as u64;
    let mut out = Vec::new();
    while v > 0 {
        out.push(DIGITS[(v % base) as usize]);
        v /= base;
    }
    out.reverse();
    out
}

/// Format a signed integer in an arbitrary base.
pub fn i64_to_radix(v: i64, base: u32) -> Vec<u8> {
    if v < 0 {
        let mut out = vec![b'-'];
        out.extend_from_slice(&to_radix((v as i128).unsigned_abs() as u64, base));
        out
    } else {
        to_radix(v as u64, base)
    }
}

/// Parse an integer from a string in the given base; `None` on any bad digit.
pub fn from_radix(text: &[u8], base: u32) -> Option<i64> {
    if !(2..=36).contains(&base) {
        return None;
    }
    let (neg, digits) = match text.first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    if digits.is_empty() {
        return None;
    }
    let mut acc: i64 = 0;
    for &c in digits {
        let d = match c {
            b'0'..=b'9' => (c - b'0') as u32,
            b'a'..=b'z' => (c - b'a' + 10) as u32,
            b'A'..=b'Z' => (c - b'A' + 10) as u32,
            _ => return None,
        };
        if d >= base {
            return None;
        }
        acc = acc.checked_mul(base as i64)?.checked_add(d as i64)?;
    }
    Some(if neg { -acc } else { acc })
}

/// Left-pad `s` with `pad` to a minimum width.
pub fn pad_left(s: &[u8], width: usize, pad: u8) -> Vec<u8> {
    if s.len() >= width {
        return s.to_vec();
    }
    let mut out = vec![pad; width - s.len()];
    out.extend_from_slice(s);
    out
}

/// Right-pad `s` with `pad` to a minimum width.
pub fn pad_right(s: &[u8], width: usize, pad: u8) -> Vec<u8> {
    if s.len() >= width {
        return s.to_vec();
    }
    let mut out = s.to_vec();
    out.resize(width, pad);
    out
}

/// Group the integer digits of `s` with `sep` every three positions.
pub fn group_thousands(s: &[u8], sep: u8) -> Vec<u8> {
    let (sign, digits): (&[u8], &[u8]) = match s.first() {
        Some(b'-') => (&s[..1], &s[1..]),
        _ => (&[], s),
    };
    let mut out = Vec::new();
    let n = digits.len();
    for (i, &c) in digits.iter().enumerate() {
        if i > 0 && (n - i) % 3 == 0 {
            out.push(sep);
        }
        out.push(c);
    }
    let mut result = sign.to_vec();
    result.extend_from_slice(&out);
    result
}
