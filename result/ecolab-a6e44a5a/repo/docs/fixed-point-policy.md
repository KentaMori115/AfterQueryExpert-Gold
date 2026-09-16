# Fixed-point policy

Public quantities use a scale of `1000000` and half-even rounding. Parsing
rejects extra fractional digits. Allocation remainders are assigned by a stable
species, stage, and region key order so file order and platform math cannot
change a published run.
