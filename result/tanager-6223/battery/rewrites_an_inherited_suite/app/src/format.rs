//! Deterministic ASCII-table rendering of query results.

use crate::api::QueryResult;

/// Render a [`QueryResult`] as an aligned ASCII table.
///
/// The layout is fully deterministic (no locale or width heuristics beyond the
/// content itself), so rendered output is stable across runs and platforms.
///
/// ```text
/// id | name
/// ---+------
/// 1  | ada
/// 2  | grace
/// (2 rows)
/// ```
pub fn render_table(result: &QueryResult) -> String {
    let columns = result.columns();
    let ncols = columns.len();

    // Column widths = max of header and every cell in that column.
    let mut widths: Vec<usize> = columns.iter().map(|c| c.chars().count()).collect();
    let cells: Vec<Vec<String>> = result
        .rows()
        .iter()
        .map(|row| {
            (0..ncols)
                .map(|c| match row.get(c) {
                    Some(v) => v.to_string(),
                    None => String::new(),
                })
                .collect()
        })
        .collect();
    for row in &cells {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.chars().count());
        }
    }

    let mut out = String::new();

    // Header.
    push_row(&mut out, &columns, &widths);
    // Separator: dashes per column joined by `-+-`.
    let sep: Vec<String> = widths.iter().map(|w| "-".repeat(*w)).collect();
    out.push_str(&sep.join("-+-"));
    out.push('\n');
    // Body.
    for row in &cells {
        push_row(&mut out, row, &widths);
    }

    let n = result.row_count();
    out.push_str(&format!("({} row{})", n, if n == 1 { "" } else { "s" }));
    out
}

fn push_row(out: &mut String, cells: &[String], widths: &[usize]) {
    let padded: Vec<String> = cells
        .iter()
        .enumerate()
        .map(|(i, c)| pad(c, widths[i]))
        .collect();
    out.push_str(&padded.join(" | "));
    // Trim trailing spaces from the last column for tidy output.
    while out.ends_with(' ') {
        out.pop();
    }
    out.push('\n');
}

fn pad(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len >= width {
        s.to_string()
    } else {
        let mut out = String::with_capacity(width);
        out.push_str(s);
        out.push_str(&" ".repeat(width - len));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    fn db() -> Database {
        let mut db = Database::new();
        db.execute("CREATE TABLE t (id INTEGER, name TEXT)")
            .unwrap();
        db.execute("INSERT INTO t VALUES (1, 'ada'), (2, 'grace')")
            .unwrap();
        db
    }

    #[test]
    fn renders_aligned_table() {
        let mut db = db();
        let result = db.query("SELECT id, name FROM t ORDER BY id").unwrap();
        let text = render_table(&result);
        let expected = "id | name\n---+------\n1  | ada\n2  | grace\n(2 rows)";
        assert_eq!(text, expected);
    }

    #[test]
    fn singular_row_count() {
        let mut db = db();
        let result = db.query("SELECT id FROM t WHERE id = 1").unwrap();
        assert!(render_table(&result).ends_with("(1 row)"));
    }
}
