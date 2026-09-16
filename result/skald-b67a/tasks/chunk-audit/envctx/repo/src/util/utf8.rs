//! UTF-8 encoding/decoding utilities — a faithful port of `util/utf8.c`.

/// Decode the codepoint starting at `bytes[i]`. Returns (codepoint, width) or
/// None on an invalid sequence.
pub fn decode_at(bytes: &[u8], i: usize) -> Option<(u32, usize)> {
    if i >= bytes.len() {
        return None;
    }
    let b0 = bytes[i];
    if b0 < 0x80 {
        return Some((b0 as u32, 1));
    }
    let (width, init) = if b0 & 0xE0 == 0xC0 {
        (2, (b0 & 0x1F) as u32)
    } else if b0 & 0xF0 == 0xE0 {
        (3, (b0 & 0x0F) as u32)
    } else if b0 & 0xF8 == 0xF0 {
        (4, (b0 & 0x07) as u32)
    } else {
        return None;
    };
    if i + width > bytes.len() {
        return None;
    }
    let mut cp = init;
    for k in 1..width {
        let b = bytes[i + k];
        if b & 0xC0 != 0x80 {
            return None;
        }
        cp = (cp << 6) | (b & 0x3F) as u32;
    }
    // reject overlong / surrogates / out of range
    let min = match width {
        2 => 0x80,
        3 => 0x800,
        _ => 0x10000,
    };
    if cp < min || (0xD800..=0xDFFF).contains(&cp) || cp > 0x10FFFF {
        return None;
    }
    Some((cp, width))
}

/// Encode a codepoint into `out`, returning the number of bytes written.
pub fn encode(cp: u32, out: &mut [u8; 4]) -> usize {
    if cp < 0x80 {
        out[0] = cp as u8;
        1
    } else if cp < 0x800 {
        out[0] = 0xC0 | (cp >> 6) as u8;
        out[1] = 0x80 | (cp & 0x3F) as u8;
        2
    } else if cp < 0x10000 {
        out[0] = 0xE0 | (cp >> 12) as u8;
        out[1] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        out[2] = 0x80 | (cp & 0x3F) as u8;
        3
    } else {
        out[0] = 0xF0 | (cp >> 18) as u8;
        out[1] = 0x80 | ((cp >> 12) & 0x3F) as u8;
        out[2] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        out[3] = 0x80 | (cp & 0x3F) as u8;
        4
    }
}

/// Validate that `bytes` is well-formed UTF-8.
pub fn validate(bytes: &[u8]) -> bool {
    let mut i = 0;
    while i < bytes.len() {
        match decode_at(bytes, i) {
            Some((_, w)) => i += w,
            None => return false,
        }
    }
    true
}

/// Count the number of codepoints (stops at the first invalid sequence).
pub fn char_count(bytes: &[u8]) -> usize {
    let mut i = 0;
    let mut n = 0;
    while i < bytes.len() {
        match decode_at(bytes, i) {
            Some((_, w)) => {
                i += w;
                n += 1;
            }
            None => break,
        }
    }
    n
}

/// Collect all codepoints into a vector.
pub fn to_codepoints(bytes: &[u8]) -> Vec<u32> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match decode_at(bytes, i) {
            Some((cp, w)) => {
                out.push(cp);
                i += w;
            }
            None => break,
        }
    }
    out
}

/// Byte length of the encoding of `cp`.
pub fn encoded_len(cp: u32) -> usize {
    if cp < 0x80 {
        1
    } else if cp < 0x800 {
        2
    } else if cp < 0x10000 {
        3
    } else {
        4
    }
}
