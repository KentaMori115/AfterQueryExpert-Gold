SlateQL stops at a parenthesised SELECT: inside an expression it is `unexpected keyword SELECT`, after FROM it is `expected table name`. Add subqueries.

Four forms. `(SELECT ...)` as a scalar expression wherever an expression may stand in SELECT, WHERE, HAVING, ORDER BY or JOIN ON. `expr [NOT] IN (SELECT ...)`. `[NOT] EXISTS (SELECT ...)`. A derived table, `FROM (SELECT ...) AS alias`, alias mandatory, AS optional, columns qualified by that alias so `alias.col` and `alias.*` resolve, rows keeping the order the inner query produced. Subquery body is any query the engine already runs, UNION, ORDER BY and LIMIT included.

Scalar and IN subqueries must produce exactly one column, BindingError otherwise. A scalar subquery carries that column's type, gives NULL on zero rows and raises ExecutionError past one row. IN follows the three-valued list rule in docs/sql-reference.md with subquery rows as the list, so NOT IN against rows holding NULL is NULL. EXISTS is TRUE once any row comes back, FALSE otherwise, never NULL, select list ignored.

A subquery may read columns of every enclosing FROM. Unqualified name binds in the innermost scope holding it; a qualifier picks the innermost FROM declaring that alias. Correlated subqueries run once per outer row, uncorrelated ones once per statement, visible through `metrics["rows_scanned"]`. Inside a grouped query's SELECT, HAVING or ORDER BY a subquery may reference outer group keys; any other outer column gets the usual GROUP BY error.

Optimizer: correlated references count as columns of their conjunct, so WHERE conjuncts carrying subqueries still move through joins and into derived tables by the existing rules; constant folding never evaluates a subquery. EXPLAIN shows subquery plans. Unparse round-trips every form. Document it all in docs/sql-reference.md, drop subqueries from Not implemented there, note it in CHANGELOG.md.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
