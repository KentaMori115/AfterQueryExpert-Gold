tanager tests membership against a written out list, but cannot ask one query inside
another. Lift that for expressions: a parenthesized `SELECT` where a value belongs,
`EXISTS (SELECT ...)`, and `IN (SELECT ...)`. `FROM` still takes tables alone, and a
subquery is read while the query runs rather than folded at plan time.

A query read as a value must return one column. No rows reads as NULL, and two or
more rows is an error raised while the query runs.

`EXISTS` counts rows without reading them, so it answers true or false, never unknown.
Membership stays three valued, like the list form: a match is true, a miss with a NULL
among the candidates is unknown, a NULL on the left likewise. `NOT IN` is that answer
turned around, so one NULL candidate holds every row out. Left and candidate types
must be comparable, and that query must have one column, both settled while binding.

An inner query resolves names against its own tables first. A name they lack is looked
up in the query around it and reads that row, so the inner query runs once per outer
row, and an outer row matching nothing reads NULL. One level only. Aggregates,
`ORDER BY` and `LIMIT` written inside belong to the inner query, and a subquery may
sit anywhere an expression may, a join condition included.

A `WHERE` conjunct carrying an outer reference stays above the join it was written
over, because an input of that join produces a different row. Self contained
predicates move as they do today.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
