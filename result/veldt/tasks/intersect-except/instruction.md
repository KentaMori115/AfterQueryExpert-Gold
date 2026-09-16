`docs/sql-support.md` files `INTERSECT` and `EXCEPT` under what veldt will not do, though
`SET_OPERATORS` holds one word and the compiler refuses anything but `union`.
Finish the pair.

Each takes an optional `ALL`, wants the same column count both sides, and publishes what
`UNION` does: left-hand names, pairwise unified types. Rows pair by value and by type once
both branches convert, so `1` and `1.0` are one row. Two nulls pair, which a comparison
between them would not.

Plain, every surviving row appears once. `INTERSECT` keeps what both sides produced, `EXCEPT`
keeps left rows the right side never produced. With `ALL` it becomes counting: a row supplied m
times on the left and n times on the right survives `min(m, n)` times under `INTERSECT`, and
`m - n` times floored at zero under `EXCEPT`. Output follows left order, each right-hand copy
cancelling earliest left copy still standing.

Chains need precedence. `INTERSECT` binds tightest, while `UNION` and `EXCEPT` sit level and read
left to right. `ORDER BY`, `LIMIT` and `OFFSET` written after the last select of a chain belong to
the whole chain, keyed on combined output names.

Pairing needs the right branch in hand before it answers, so each reports as blocking;
a concatenation still does not. Estimation reads that same arithmetic over branch row counts
rather than row copies. `ALL` reports the bound it gives, the plain spelling scales that as a
union's is, floored at zero not one.

Answers must not move when the optimizer runs, or when batch size changes. Mismatched column
counts raise the planning error a bad `UNION` raises. `EXPLAIN` names each the way it names a
union: `Intersect: distinct`, `Except: all`.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
