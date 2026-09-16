//! Path and environment string utilities — a faithful port of the pure portion
//! of `lib/os_lib.c`.
//!
//! These operate purely on byte strings; they perform no filesystem or
//! environment access, so the build stays deterministic and sandbox-safe.

const SEP: u8 = b'/';

/// Join two path components with a single separator.
pub fn join(a: &[u8], b: &[u8]) -> Vec<u8> {
    if a.is_empty() {
        return b.to_vec();
    }
    if b.is_empty() {
        return a.to_vec();
    }
    let mut out = a.to_vec();
    if *out.last().unwrap() != SEP {
        out.push(SEP);
    }
    let start = if b[0] == SEP { 1 } else { 0 };
    out.extend_from_slice(&b[start..]);
    out
}

/// Final path component (after the last separator).
pub fn basename(path: &[u8]) -> Vec<u8> {
    let trimmed = trim_trailing_sep(path);
    match trimmed.iter().rposition(|&c| c == SEP) {
        Some(i) => trimmed[i + 1..].to_vec(),
        None => trimmed.to_vec(),
    }
}

/// Directory portion (before the last separator).
pub fn dirname(path: &[u8]) -> Vec<u8> {
    let trimmed = trim_trailing_sep(path);
    match trimmed.iter().rposition(|&c| c == SEP) {
        Some(0) => vec![SEP],
        Some(i) => trimmed[..i].to_vec(),
        None => b".".to_vec(),
    }
}

/// File extension including the dot, or empty if none.
pub fn extension(path: &[u8]) -> Vec<u8> {
    let base = basename(path);
    match base.iter().rposition(|&c| c == b'.') {
        Some(0) | None => Vec::new(),
        Some(i) => base[i..].to_vec(),
    }
}

/// Strip the extension from the final component.
pub fn stem(path: &[u8]) -> Vec<u8> {
    let base = basename(path);
    match base.iter().rposition(|&c| c == b'.') {
        Some(0) | None => base,
        Some(i) => base[..i].to_vec(),
    }
}

fn trim_trailing_sep(path: &[u8]) -> &[u8] {
    let mut end = path.len();
    while end > 1 && path[end - 1] == SEP {
        end -= 1;
    }
    &path[..end]
}

/// True for an absolute (leading-separator) path.
pub fn is_absolute(path: &[u8]) -> bool {
    path.first() == Some(&SEP)
}

/// Split a path into its components, discarding empty segments.
pub fn components(path: &[u8]) -> Vec<Vec<u8>> {
    path.split(|&c| c == SEP)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_vec())
        .collect()
}

/// Normalise `.` and `..` segments lexically (no filesystem access).
pub fn normalize(path: &[u8]) -> Vec<u8> {
    let absolute = is_absolute(path);
    let mut stack: Vec<Vec<u8>> = Vec::new();
    for comp in components(path) {
        if comp == b"." {
            continue;
        } else if comp == b".." {
            if !stack.is_empty() && stack.last().map(|s| s.as_slice()) != Some(b"..") {
                stack.pop();
            } else if !absolute {
                stack.push(comp);
            }
        } else {
            stack.push(comp);
        }
    }
    let mut out = Vec::new();
    if absolute {
        out.push(SEP);
    }
    for (i, comp) in stack.iter().enumerate() {
        if i > 0 {
            out.push(SEP);
        }
        out.extend_from_slice(comp);
    }
    if out.is_empty() {
        out.push(b'.');
    }
    out
}
