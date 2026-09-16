tanager tests membership against a written out list, never against another query. Lift
that for expressions: a parenthesized `SELECT` where a value belongs, `EXISTS (SELECT
...)`, and `IN (SELECT ...)`. A subquery is read while the query runs, never folded.

A value query returns one column, checked while binding. No rows reads NULL; two or more
rows is a run time error.

`EXISTS` answers from whether any row came back, true or false, never unknown; its rows
are produced as usual, so an error inside one is raised. Membership stays three valued:
a match is true, a miss with a NULL among the candidates unknown, a NULL on the left
likewise. `NOT IN` is that answer turned around, so one NULL candidate holds every row
out. Left and candidate types must be comparable, and that query have one column, both
settled while binding.

An inner query resolves names against its own tables first. A name they lack comes from
the query around it and reads that row, so it runs once per outer row, and an outer row
matching nothing reads NULL. One level only. Under `GROUP BY` that row is the grouped
one: grouping columns readable by their output names, nothing else. Aggregates, `ORDER
BY` and `LIMIT` written inside belong to the inner query, and a subquery sits anywhere
an expression may: a join condition, an `INSERT` value, an `ORDER BY` or `GROUP BY` key.

A `WHERE` conjunct carrying an outer reference stays above its join: an input of that
join is a different row. Self contained predicates keep moving. `EXPLAIN` shows each
query an operator runs: a `Subquery` line one step inside it, that query's plan beneath,
inputs after.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
