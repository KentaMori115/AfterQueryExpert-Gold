//! A minimal end-to-end example: create a table, insert rows, and query.
//!
//! Run with: `cargo run --example basic`

use tanager::{render_table, Database};

fn main() {
    let mut db = Database::new();

    db.execute("CREATE TABLE books (id INTEGER, title TEXT, year INTEGER, pages INTEGER)")
        .unwrap();
    db.execute(
        "INSERT INTO books VALUES \
            (1, 'The Rust Programming Language', 2018, 560), \
            (2, 'Programming Rust', 2021, 736), \
            (3, 'Rust for Rustaceans', 2021, 280), \
            (4, 'Rust in Action', 2021, 456)",
    )
    .unwrap();

    println!("Books published in 2021, longest first:\n");
    let result = db
        .query(
            "SELECT title, pages FROM books \
             WHERE year = 2021 ORDER BY pages DESC",
        )
        .unwrap();
    println!("{}", render_table(&result));

    println!("\nTotal and average page count:\n");
    let result = db
        .query("SELECT COUNT(*) AS titles, SUM(pages) AS total, AVG(pages) AS mean FROM books")
        .unwrap();
    println!("{}", render_table(&result));
}
