Rows go into a tanager table and then sit there forever: INSERT is the only writer. Two
statements to add:

    UPDATE table [alias] SET col = expr {, col = expr} [WHERE expr]
    DELETE FROM table [alias] [WHERE expr]

Leave the WHERE off and every row is fair game. Put one on and a row is taken only where
that predicate comes out true; false and unknown leave it alone. An alias, when you give
one, qualifies columns in SET and WHERE.

Each right hand side reads the row as it stood before the statement, not as the
assignments leave it, so SET a = b, b = a swaps two columns. Values go in under the rules
INSERT follows: an INTEGER widens into a FLOAT column, nothing else converts, and a NOT
NULL column refuses a NULL however that NULL arose. Build and check every candidate row
before you touch a column. One row you cannot compute or store ends the statement with
the table as it was, and no other table moves.

DELETE takes matched rows out and leaves survivors in the order they were stored. UPDATE
writes its rows where they already sit.

Database::execute answers with two more Outcome variants. Deleted(usize) carries how many
rows went. Updated(usize) carries how many rows hold different values afterwards, so a
matched row that comes out identical is not counted.

Errors keep the kinds the engine already uses. Catalog when the table is not there. Binder
for an unknown column, a WHERE that is not boolean, an aggregate call, or one column
assigned twice in a SET list. Type when a value cannot go in that column.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
