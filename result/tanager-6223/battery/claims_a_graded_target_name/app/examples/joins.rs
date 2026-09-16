//! Joining two tables and aggregating across the join.
//!
//! Run with: `cargo run --example joins`

use tanager::{render_table, Database};

fn main() {
    let mut db = Database::new();
    db.execute("CREATE TABLE authors (id INTEGER, name TEXT)")
        .unwrap();
    db.execute("CREATE TABLE posts (id INTEGER, author_id INTEGER, views INTEGER)")
        .unwrap();

    db.execute("INSERT INTO authors VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Linus')")
        .unwrap();
    db.execute(
        "INSERT INTO posts VALUES \
            (1, 1, 500), (2, 1, 1200), (3, 2, 300), (4, 2, 900), (5, 2, 100)",
    )
    .unwrap();

    println!("Posts and their authors (inner join):\n");
    let result = db
        .query(
            "SELECT a.name, p.views FROM posts p \
             JOIN authors a ON p.author_id = a.id ORDER BY p.views DESC",
        )
        .unwrap();
    println!("{}", render_table(&result));

    println!("\nTotal views per author, including authors with no posts (left join):\n");
    let result = db
        .query(
            "SELECT a.name, COALESCE(SUM(p.views), 0) AS total \
             FROM authors a LEFT JOIN posts p ON a.id = p.author_id \
             GROUP BY a.name ORDER BY total DESC",
        )
        .unwrap();
    println!("{}", render_table(&result));
}
