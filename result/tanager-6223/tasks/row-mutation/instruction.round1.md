tanager writes rows only through `INSERT`. Add the two statements that change what is
already stored:

```
UPDATE table [alias] SET col = expr {, col = expr} [WHERE expr]
DELETE FROM table [alias] [WHERE expr]
```

Without `WHERE` a statement takes every row. With one, a row is taken only where the
predicate comes out `TRUE`, so `FALSE` and unknown both leave it where it is. An alias,
where given, qualifies columns in `SET` and `WHERE`.

Right hand sides read the stored row as it stood before the statement, so
`SET a = b, b = a` swaps two columns and assignments never see each other. Values land
under rules `INSERT` already follows: an `INTEGER` widens into a `FLOAT` column, nothing
else converts, and a `NOT NULL` column refuses `NULL` however that `NULL` arose. Check
every candidate row before touching any column. One row that cannot be computed or stored
ends the statement with the table exactly as it was, and nothing outside that table moves.

`DELETE` drops matched rows and leaves survivors in the order they were stored. `UPDATE`
writes matched rows where they already sit.

`Database::execute` answers with two more `Outcome` variants: `Deleted(usize)`, rows
removed, and `Updated(usize)`, rows whose stored values differ afterwards. A matched row
that comes out identical is not one of them.

Errors carry the kinds the engine already uses. `Catalog` for a table that is not there.
`Binder` for an unknown column, a `WHERE` that is not boolean, an aggregate call, or one
column assigned twice in a `SET` list. `Type` for a value whose type the column cannot
hold.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
