//! CSV reader and writer — part of the standard-library subsystem.
//!
//! Handles RFC 4180-style quoting: fields may be wrapped in double quotes,
//! embedded quotes are doubled, and quoted fields may contain commas and
//! newlines. Pure byte-level processing.

/// Parse a CSV document into rows of field byte-strings.
pub fn parse(data: &[u8]) -> Vec<Vec<Vec<u8>>> {
    let mut rows = Vec::new();
    let mut row: Vec<Vec<u8>> = Vec::new();
    let mut field: Vec<u8> = Vec::new();
    let mut in_quotes = false;
    let mut i = 0;
    let mut field_started = false;

    while i < data.len() {
        let c = data[i];
        if in_quotes {
            if c == b'"' {
                if i + 1 < data.len() && data[i + 1] == b'"' {
                    field.push(b'"');
                    i += 2;
                    continue;
                }
                in_quotes = false;
            } else {
                field.push(c);
            }
            i += 1;
        } else {
            match c {
                b'"' if field.is_empty() && !field_started => {
                    in_quotes = true;
                    field_started = true;
                    i += 1;
                }
                b',' => {
                    row.push(std::mem::take(&mut field));
                    field_started = false;
                    i += 1;
                }
                b'\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    field_started = false;
                    i += 1;
                }
                b'\r' => {
                    i += 1;
                }
                _ => {
                    field.push(c);
                    field_started = true;
                    i += 1;
                }
            }
        }
    }
    if field_started || !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// Serialise rows back into a CSV document, quoting fields as needed.
pub fn write(rows: &[Vec<Vec<u8>>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        if r > 0 {
            out.push(b'\n');
        }
        for (c, field) in row.iter().enumerate() {
            if c > 0 {
                out.push(b',');
            }
            write_field(&mut out, field);
        }
    }
    out
}

fn write_field(out: &mut Vec<u8>, field: &[u8]) {
    let needs_quote = field
        .iter()
        .any(|&c| c == b',' || c == b'"' || c == b'\n' || c == b'\r');
    if needs_quote {
        out.push(b'"');
        for &c in field {
            if c == b'"' {
                out.push(b'"');
            }
            out.push(c);
        }
        out.push(b'"');
    } else {
        out.extend_from_slice(field);
    }
}

/// Count the number of columns in the widest row.
pub fn max_columns(rows: &[Vec<Vec<u8>>]) -> usize {
    rows.iter().map(|r| r.len()).max().unwrap_or(0)
}
