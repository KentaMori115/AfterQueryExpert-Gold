//! Byte-string text helpers — the pure, allocation-returning half of
//! `lib/string_lib.c` that does not need the object heap.

/// ASCII title-case: capitalise the first letter of each whitespace-separated
/// word, lower-casing the rest.
pub fn title_case(s: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    let mut at_word_start = true;
    for &c in s {
        if c.is_ascii_whitespace() {
            out.push(c);
            at_word_start = true;
        } else if at_word_start {
            out.push(c.to_ascii_uppercase());
            at_word_start = false;
        } else {
            out.push(c.to_ascii_lowercase());
        }
    }
    out
}

/// Swap the case of every ASCII letter.
pub fn swap_case(s: &[u8]) -> Vec<u8> {
    s.iter()
        .map(|&c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else if c.is_ascii_lowercase() {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect()
}

/// Left-pad to `width` with `pad`.
pub fn pad_left(s: &[u8], width: usize, pad: u8) -> Vec<u8> {
    if s.len() >= width {
        return s.to_vec();
    }
    let mut out = vec![pad; width - s.len()];
    out.extend_from_slice(s);
    out
}

/// Right-pad to `width` with `pad`.
pub fn pad_right(s: &[u8], width: usize, pad: u8) -> Vec<u8> {
    if s.len() >= width {
        return s.to_vec();
    }
    let mut out = s.to_vec();
    out.resize(width, pad);
    out
}

/// Centre `s` within `width`, padding with `pad` on both sides.
pub fn center(s: &[u8], width: usize, pad: u8) -> Vec<u8> {
    if s.len() >= width {
        return s.to_vec();
    }
    let total = width - s.len();
    let left = total / 2;
    let right = total - left;
    let mut out = vec![pad; left];
    out.extend_from_slice(s);
    out.extend(std::iter::repeat(pad).take(right));
    out
}

/// Count non-overlapping occurrences of `needle` in `hay`.
pub fn count_occurrences(hay: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || needle.len() > hay.len() {
        return 0;
    }
    let mut count = 0;
    let mut i = 0;
    while i + needle.len() <= hay.len() {
        if &hay[i..i + needle.len()] == needle {
            count += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    count
}

/// Replace all non-overlapping occurrences of `needle` with `replacement`.
pub fn replace_all(hay: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    if needle.is_empty() {
        return hay.to_vec();
    }
    let mut out = Vec::with_capacity(hay.len());
    let mut i = 0;
    while i < hay.len() {
        if i + needle.len() <= hay.len() && &hay[i..i + needle.len()] == needle {
            out.extend_from_slice(replacement);
            i += needle.len();
        } else {
            out.push(hay[i]);
            i += 1;
        }
    }
    out
}

/// Trim a set of characters from both ends.
pub fn trim_chars(s: &[u8], chars: &[u8]) -> Vec<u8> {
    let is_trim = |c: u8| chars.contains(&c);
    let start = s.iter().position(|&c| !is_trim(c)).unwrap_or(s.len());
    let end = s
        .iter()
        .rposition(|&c| !is_trim(c))
        .map(|x| x + 1)
        .unwrap_or(start);
    s[start..end].to_vec()
}

/// Join byte-string parts with a separator.
pub fn join(parts: &[Vec<u8>], sep: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(sep);
        }
        out.extend_from_slice(p);
    }
    out
}

/// Levenshtein edit distance between two byte strings.
pub fn edit_distance(a: &[u8], b: &[u8]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}
