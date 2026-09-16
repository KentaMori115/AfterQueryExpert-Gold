SlateQL stops at `OVER`. Close that.

`OVER` makes a call read a window of rows, and every input row survives. Any
aggregate accepts one, as do `ROW_NUMBER`, `RANK` and `DENSE_RANK`,
argument-free, meaningless without it, and the registry keeps its two kinds,
scalar and aggregate. `PARTITION BY` splits the input like `GROUP BY`, nulls
together; absent, one partition. Ordering inside `OVER` reads like the
statement's own, `ASC`/`DESC`, `NULLS FIRST`/`NULLS LAST`, defaulting to the
session `null_ordering`.

Rows sharing all ordering values are peers: `ROW_NUMBER` numbers them one by
one, `RANK` gives each the position its run began at, `DENSE_RANK` counts
runs. Unordered, an aggregate covers the partition; ordered, everything
through the current run's end.

A `ROWS` frame counts rows rather than peers: `ROWS 2 PRECEDING`, in full
`ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`, covers the current row and two
before it; `UNBOUNDED PRECEDING` reaches the partition start. `RANGE 10
PRECEDING` reaches back by value, fractionally if asked, over one numeric
ordering key: earlier-or-equal rows within 10 of the current value, peers
included; a row with no value folds only its peers. After a frame, `EXCLUDE
CURRENT ROW` drops the row itself, `EXCLUDE TIES` its peers but not the row,
`EXCLUDE GROUP` both, `EXCLUDE NO OTHERS` nothing; an emptied frame folds no
rows. Frames need an ordering; ranking calls carry none.

Windows go in the select list or `ORDER BY`, never in `WHERE`, `GROUP BY` or
`HAVING`; a windowed call cannot carry `DISTINCT`, nor a scalar function
`OVER`. A window may fold a grouped query's aggregates: `SUM(COUNT(*)) OVER
()` is the row count across every group. One pass serves every window, and
rows keep arrival order until the statement sorts.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
