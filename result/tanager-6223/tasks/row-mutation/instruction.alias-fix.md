README grammar runs select, insert, create_table, drop_table. Rows land once and stay
there. Fill the gap:

    UPDATE table [[AS] alias] SET col = expr {, col = expr} [WHERE expr]
    DELETE FROM table [[AS] alias] [WHERE expr]

No WHERE, every row. With one, only rows whose predicate comes out TRUE, so FALSE and
unknown both stay put. Alias, where written, qualifies columns in SET and in WHERE.

Right-hand sides read stored row as it stood before the statement, not as assignments
leave it, so SET a = b, b = a swaps two columns. Values land under rules INSERT already
follows. INTEGER widens into a FLOAT column, nothing else converts, and a NOT NULL column
refuses NULL however that NULL arose. Build every candidate row and check it before
touching a column. One row that cannot be computed or stored ends the statement with the
table as it was. Nothing outside that table moves.

DELETE drops matched rows, survivors keeping stored order. UPDATE writes matched rows
where they already sit.

Database::execute answers two more Outcome variants. Deleted(usize), rows removed.
Updated(usize), rows holding different values afterwards, so a matched row that comes out
identical is not one of them.

Error kinds stay the engine's own. Catalog, table not there. Binder, unknown column, a
WHERE that is not boolean, an aggregate call, or one column assigned twice in a SET list.
Type, a value the column cannot hold.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
