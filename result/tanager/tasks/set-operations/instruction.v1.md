tanager runs one SELECT at a time. Combine several: UNION, INTERSECT and EXCEPT, each plain and with ALL.

Branches combine by position, so they need the same column count and every column pair must unify under `DataType::unify`; anything else is a binder error. Result columns take their names from the leftmost branch and their type from that unification, and a branch on the narrow side carries its values over: rows pair by value and type, so INTEGER 1 is not FLOAT 1.0 until one moves.

Two rows are one when every column shares a `Value::group_key`, which puts NULL alongside NULL. Plain spellings report each survivor once. ALL counts instead: everything for UNION, the smaller count for INTERSECT, left less right floored at zero for EXCEPT, keeping the leading copies. Output follows the left branch in first-seen order, a union appending rows the left did not hold. A branch is still an ordinary SELECT, so its WHERE, GROUP BY and DISTINCT are its own.

INTERSECT pairs off first, the rest fold from the left. ORDER BY, LIMIT and OFFSET are written once, after the last branch, and govern the combined result; earlier is a parse error. An ORDER BY key resolves against result columns, by name or by position. EXPLAIN shows each operator as written, `UNION ALL` and the rest.

Then LimitPushdown. It bounds both branches of a UNION ALL by the limit plus the offset, and the outer limit stays. Nothing else can be bounded that way, a Sort in between stops it, and a branch already carrying the bound is left alone.

`Statement::Select` still carries a `SelectStmt`, `Binder::bind_select` keeps its shape. docs/DESIGN.md has the pipeline.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
