//! A small analytics report built from grouping, HAVING, and CASE.
//!
//! Run with: `cargo run --example report`

use tanager::{render_table, Database};

fn main() {
    let mut db = Database::new();
    db.execute("CREATE TABLE sales (id INTEGER, region TEXT, product TEXT, amount INTEGER)")
        .unwrap();
    db.execute(
        "INSERT INTO sales VALUES \
            (1, 'North', 'widget', 1200), \
            (2, 'North', 'gadget', 800), \
            (3, 'South', 'widget', 1500), \
            (4, 'South', 'gadget', 400), \
            (5, 'East',  'widget', 300), \
            (6, 'East',  'gadget', 250), \
            (7, 'North', 'widget', 1100)",
    )
    .unwrap();

    println!("Regions with total sales over 1000, ranked:\n");
    let result = db
        .query(
            "SELECT region, \
                    SUM(amount) AS revenue, \
                    COUNT(*) AS orders, \
                    CASE WHEN SUM(amount) >= 2000 THEN 'tier-1' ELSE 'tier-2' END AS tier \
             FROM sales \
             GROUP BY region \
             HAVING SUM(amount) > 1000 \
             ORDER BY revenue DESC",
        )
        .unwrap();
    println!("{}", render_table(&result));
}
