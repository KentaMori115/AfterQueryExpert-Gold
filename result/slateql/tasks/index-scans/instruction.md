`slateql/storage/index.py` has carried `HashIndex` and `SortedIndex` since 0.2.0,
finished, tested and consulted by nothing. Wire them in.

`create_index(table, column, kind="hash")` or `kind="sorted"` builds one;
`drop_index(table, column)` removes it, reporting whether it removed anything.
Indexing a column that already has one replaces it. An unknown table or column
raises what a query would.

`SHOW INDEXES`, or `SHOW INDEXES FROM t`, lists them ordered by table then
column, with columns `table_name`, `column_name`, `kind`, `entries`,
`distinct_keys` and `has_nulls`. `has_nulls` reads `YES` or `NO`; `entries`
counts every row the index was built from, nulls included.

Then teach the planner. Among the predicates pushed into a scan, a hash
index answers equality, `IN` and `IS NULL`; a sorted index answers equality,
`IN` and ranges, and can feed a single `ORDER BY` key on its own column straight
out in order, sorting nothing and reading no further than the consumer asks. A
key or bound of NULL is unknown against every row, so that predicate matches and
reads nothing; a NULL among `IN` keys is not one of them. Predicates an index
cannot answer still get applied. One index serves a scan at most: a lookup beats
a range, a range beats an ordered read, then the first indexed column in the
schema wins.

No answer may change: same rows, same order as before. What changes is
`rows_scanned`, the rows an access path really reads.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
