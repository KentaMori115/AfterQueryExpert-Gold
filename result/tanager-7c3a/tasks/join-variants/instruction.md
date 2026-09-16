tanager parses `INNER` and `LEFT` joins today. Add the rest of the family.

`RIGHT JOIN` keeps a right row that nothing matched, filling the left columns with NULL, and `FULL JOIN` does that for both sides at once. `OUTER` after `LEFT`, `RIGHT` or `FULL` is noise. `CROSS JOIN` pairs every left row with every right row and carries no constraint, so `ON` or `USING` after it is a parse error, and so is leaving one off any other join.

Rows come out left first: pairings in left order, and inside one left row in right order. Rows only the right side supplies close the result, in right order.

`USING (a, b)` pairs rows whose named columns are all equal. Each named column becomes a single output column carrying whichever side is not null, and those columns lead the row in the order they were named, ahead of the left's remaining columns and then the right's. `*` shows such a column once, and a bare name or either table's qualifier reaches it. Naming a column twice, or one that a side does not have, or two columns whose types have nothing in common, is a binder error. Where two numeric widths meet the column settles on the wider one, and its values read back as that type.

Everything else keeps working over these joins, and the rewrites in `optimizer` still have to hand back the rows their plan would return without them. `docs/DESIGN.md` carries the invariants each stage leans on.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
