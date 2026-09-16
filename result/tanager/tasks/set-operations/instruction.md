tanager's binder turns one SELECT into a plan. Teach it to combine several, with UNION, INTERSECT and EXCEPT, each plain and with ALL.

Two branches meet by position: same column count, every column pair unified by `DataType::unify`, or the binder refuses. Result columns take names from the leftmost branch and types from that unification, and the narrow side is carried over value by value, since rows pair by value and type. INTEGER 1 is not FLOAT 1.0 until one of them moves. Pairing runs on `Value::group_key`, the key `DISTINCT` already uses, so NULL meets NULL.

Plain spellings report each survivor once. ALL counts: everything, the smaller count, or left less right floored at zero, keeping the leading copies. Output follows the left branch in first-seen order, a union appending what it did not hold. WHERE, GROUP BY and DISTINCT still belong to whichever branch they were written in.

INTERSECT pairs off first, the rest fold from the left. ORDER BY, LIMIT and OFFSET are written once, after the last branch, and govern the whole result; earlier is a parse error. An ORDER BY key reaches result columns only, by name or position. EXPLAIN prints each operator as written, `UNION ALL` and the rest.

`LimitPushdown` gains a second job. Over a UNION ALL it bounds both branches by the limit plus the offset, and the outer limit stays to do the cutting. Nothing else takes that bound, a Sort in between stops it, and a branch already carrying it is left alone, since the rule runs to a fixpoint.

`Statement::Select` still carries a `SelectStmt`, `Binder::bind_select` keeps its shape. docs/DESIGN.md has the pipeline.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
