//! `tanager` command-line runner.
//!
//! Usage:
//!   tanager "SELECT 1 + 1"          run one or more `;`-separated statements
//!   tanager < script.sql            read SQL from standard input
//!
//! `SELECT` results are printed as ASCII tables; other statements print a short
//! status line. The process exits non-zero on the first error.

use std::io::Read;

use tanager::{render_table, Database, Outcome};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let sql = if args.is_empty() {
        let mut buf = String::new();
        if std::io::stdin().read_to_string(&mut buf).is_err() {
            eprintln!("tanager: failed to read standard input");
            std::process::exit(2);
        }
        buf
    } else {
        args.join(" ")
    };

    if sql.trim().is_empty() {
        eprintln!("tanager {}: no SQL provided", env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }

    let mut db = Database::new();
    match db.execute_script(&sql) {
        Ok(outcomes) => {
            for outcome in outcomes {
                print_outcome(&outcome);
            }
        }
        Err(e) => {
            eprintln!("error: {}", e);
            std::process::exit(1);
        }
    }
}

fn print_outcome(outcome: &Outcome) {
    match outcome {
        Outcome::Query(result) => println!("{}", render_table(result)),
        Outcome::Inserted(n) => println!("INSERT {}", n),
        Outcome::Updated(n) => println!("UPDATE {}", n),
        Outcome::Deleted(n) => println!("DELETE {}", n),
        Outcome::TableCreated(name) => println!("CREATE TABLE {}", name),
        Outcome::TableDropped(name) => println!("DROP TABLE {}", name),
    }
}
