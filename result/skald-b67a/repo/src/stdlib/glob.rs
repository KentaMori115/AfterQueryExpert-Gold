//! Shell-style glob matching — part of the standard-library subsystem.
//!
//! Supports `*` (any run, not crossing nothing special), `?` (single byte),
//! and `[...]` character classes with ranges and `!`/`^` negation. Matching is
//! iterative with backtracking on `*`.

pub fn matches(pattern: &[u8], text: &[u8]) -> bool {
    let mut p = 0;
    let mut t = 0;
    let mut star_p = usize::MAX;
    let mut star_t = 0;

    while t < text.len() {
        if p < pattern.len() {
            match pattern[p] {
                b'*' => {
                    star_p = p;
                    star_t = t;
                    p += 1;
                    continue;
                }
                b'?' => {
                    p += 1;
                    t += 1;
                    continue;
                }
                b'[' => {
                    if let Some((matched, np)) = match_class(pattern, p, text[t]) {
                        if matched {
                            p = np;
                            t += 1;
                            continue;
                        }
                    }
                }
                c => {
                    if c == text[t] {
                        p += 1;
                        t += 1;
                        continue;
                    }
                }
            }
        }
        // mismatch — backtrack to the last '*'
        if star_p != usize::MAX {
            p = star_p + 1;
            star_t += 1;
            t = star_t;
        } else {
            return false;
        }
    }

    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

/// Match a `[...]` class at `start` against `c`. Returns `(matched, next_pos)`.
fn match_class(pattern: &[u8], start: usize, c: u8) -> Option<(bool, usize)> {
    let mut i = start + 1;
    let mut negated = false;
    if i < pattern.len() && (pattern[i] == b'!' || pattern[i] == b'^') {
        negated = true;
        i += 1;
    }
    let mut matched = false;
    while i < pattern.len() && pattern[i] != b']' {
        if i + 2 < pattern.len() && pattern[i + 1] == b'-' && pattern[i + 2] != b']' {
            if pattern[i] <= c && c <= pattern[i + 2] {
                matched = true;
            }
            i += 3;
        } else {
            if pattern[i] == c {
                matched = true;
            }
            i += 1;
        }
    }
    if i >= pattern.len() {
        return None; // unterminated class
    }
    Some((matched != negated, i + 1))
}
